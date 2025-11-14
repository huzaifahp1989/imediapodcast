let mediaRecorder;
let chunks = [];
let audioBlob = null;
let startTime = 0;
let pausedAt = 0;
let timerInterval = null;
let stream;
let audioCtx, analyser, sourceNode;
let durationMs = 0;

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const timer = document.getElementById('timer');
const levelBar = document.getElementById('levelBar');
const playback = document.getElementById('playback');
const player = document.getElementById('player');
const reRecordBtn = document.getElementById('reRecordBtn');
const confirmBtn = document.getElementById('confirmBtn');
const trimStart = document.getElementById('trimStart');
const trimEnd = document.getElementById('trimEnd');
const form = document.getElementById('recForm');

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}
function updateTimer() {
  const now = Date.now();
  durationMs = now - startTime - pausedAt;
  timer.textContent = fmt(durationMs);
}
function visualize() {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  function draw() {
    analyser.getByteTimeDomainData(dataArray);
    let peak = 0;
    for (let i=0;i<dataArray.length;i++) {
      const v = Math.abs(dataArray[i]-128);
      if (v>peak) peak=v;
    }
    const pct = Math.min(100, Math.floor((peak/128)*100));
    levelBar.style.width = pct + '%';
    requestAnimationFrame(draw);
  }
  draw();
}
async function startRecording() {
  chunks = [];
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  mediaRecorder.ondataavailable = e => { if (e.data.size>0) chunks.push(e.data); };
  mediaRecorder.onstop = onStop;
  mediaRecorder.start();
  startTime = Date.now(); pausedAt=0;
  timerInterval = setInterval(updateTimer, 250);
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  stopBtn.disabled = false;
  resumeBtn.disabled = true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  sourceNode.connect(analyser);
  visualize();
}
function pauseRecording() {
  mediaRecorder.pause();
  resumeBtn.disabled = false;
  pauseBtn.disabled = true;
}
function resumeRecording() {
  mediaRecorder.resume();
  resumeBtn.disabled = true;
  pauseBtn.disabled = false;
}
function stopRecording() {
  mediaRecorder.stop();
  stream.getTracks().forEach(t => t.stop());
  clearInterval(timerInterval);
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resumeBtn.disabled = true;
  stopBtn.disabled = true;
}
function onStop() {
  audioBlob = new Blob(chunks, { type: 'audio/webm' });
  const url = URL.createObjectURL(audioBlob);
  player.src = url;
  playback.classList.remove('hidden');
  trimStart.value = 0;
  trimEnd.value = 100;
}
function reRecord() {
  playback.classList.add('hidden');
  player.src = '';
  audioBlob = null;
}
async function blobToArrayBuffer(blob) {
  return await blob.arrayBuffer();
}
function slicePCM(audioBuffer, startFrac, endFrac) {
  const start = Math.floor(audioBuffer.length * startFrac);
  const end = Math.floor(audioBuffer.length * endFrac);
  const length = Math.max(0, end - start);
  const newBuffer = new AudioBuffer({ length, sampleRate: audioBuffer.sampleRate, numberOfChannels: audioBuffer.numberOfChannels });
  for (let ch=0; ch<audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch).slice(start, end);
    newBuffer.copyToChannel(data, ch);
  }
  return newBuffer;
}
function bufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const resp = new ArrayBuffer(length);
  const view = new DataView(resp);
  let offset = 0;
  function writeString(s) { for (let i=0;i<s.length;i++) view.setUint8(offset++, s.charCodeAt(i)); }
  function write16(d) { view.setUint16(offset, d, true); offset+=2; }
  function write32(d) { view.setUint32(offset, d, true); offset+=4; }
  writeString('RIFF'); write32(length-8); writeString('WAVEfmt '); write32(16); write16(1); write16(numOfChan);
  write32(buffer.sampleRate); write32(buffer.sampleRate * numOfChan * 2); write16(numOfChan * 2); write16(16);
  writeString('data'); write32(buffer.length * numOfChan * 2);
  let chanData = [];
  for (let ch=0; ch<numOfChan; ch++) chanData.push(buffer.getChannelData(ch));
  for (let i=0; i<buffer.length; i++) {
    for (let ch=0; ch<numOfChan; ch++) {
      let s = Math.max(-1, Math.min(1, chanData[ch][i]));
      view.setInt16(offset, s < 0 ? s*0x8000 : s*0x7FFF, true);
      offset+=2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
async function confirmSubmit() {
  if (!audioBlob) return;
  const startPct = Number(trimStart.value)/100;
  const endPct = Number(trimEnd.value)/100;
  const ab = await blobToArrayBuffer(audioBlob);
  const realCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await realCtx.decodeAudioData(ab);
  const sliced = slicePCM(decoded, startPct, endPct);
  const wavBlob = bufferToWav(sliced);
  const fd = new FormData();
  fd.append('media', wavBlob, 'recording.wav');
  const fields = new FormData(form);
  fields.forEach((v,k)=>fd.append(k,v));
  fd.append('durationMs', Math.floor(sliced.duration*1000));
  const res = await fetch('/api/recordings', { method: 'POST', body: fd });
  const json = await res.json();
  if (json && json.ok) {
    alert('Submitted for review.');
    window.location.href = '/library';
  } else {
    alert('Submission failed.');
  }
}

startBtn.addEventListener('click', startRecording);
pauseBtn.addEventListener('click', ()=>{ pausedAt += Date.now() - (startTime + pausedAt); pauseRecording(); });
resumeBtn.addEventListener('click', resumeRecording);
stopBtn.addEventListener('click', stopRecording);
reRecordBtn.addEventListener('click', reRecord);
confirmBtn.addEventListener('click', confirmSubmit);