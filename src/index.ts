
import './style.css'

import $ from 'jquery';
import { Subscription, interval } from 'rxjs';
import { TwistyPlayer } from 'cubing/twisty';
import { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';

import * as THREE from 'three';

import {
  now,
  connectGanCube,
  GanCubeConnection,
  GanCubeEvent,
  GanCubeMove,
  MacAddressProvider,
  makeTimeFromTimestamp,
  cubeTimestampCalcSkew,
  cubeTimestampLinearFit
} from 'gan-web-bluetooth';

import { faceletsToPattern, patternToFacelets } from './utils';

/*
  state = 9x5 chars (one of URFDLB)
  "Up face" (9 chars) - white
  "Right face" (9 chars) - red
  "Front face" (9 chars) - green
  "Down face" (9 chars) - yellow
  "Left face" (9 chars) - orange
  "Back face" (9 chars) - blue
*/


const SOLVED_STATE = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";


var twistyPlayer = new TwistyPlayer({
  puzzle: '3x3x3',
  visualization: 'PG3D',
  alg: '',
  experimentalSetupAnchor: 'start',
  background: 'none',
  controlPanel: 'none',
  hintFacelets: 'none',
  experimentalDragInput: 'none',
  cameraLatitude: 0,
  cameraLongitude: 0,
  cameraLatitudeLimit: 0,
  tempoScale: 5
});

$('#cube').append(twistyPlayer);

var conn: GanCubeConnection | null;
var lastMoves: GanCubeMove[] = [];
var solutionMoves: GanCubeMove[] = [];

var twistyScene: THREE.Scene;
var twistyVantage: any;

const HOME_ORIENTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(15 * Math.PI / 180, -20 * Math.PI / 180, 0));
var cubeQuaternion: THREE.Quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(30 * Math.PI / 180, -30 * Math.PI / 180, 0));

async function amimateCubeOrientation() {
  if (!twistyScene || !twistyVantage) {
    var vantageList = await twistyPlayer.experimentalCurrentVantages();
    twistyVantage = [...vantageList][0];
    twistyScene = await twistyVantage.scene.scene();
  }
  twistyScene.quaternion.slerp(cubeQuaternion, 0.25);
  twistyVantage.render();
  requestAnimationFrame(amimateCubeOrientation);
}
requestAnimationFrame(amimateCubeOrientation);

var basis: THREE.Quaternion | null;

async function handleGyroEvent(event: GanCubeEvent) {
  if (event.type == "GYRO") {
    let { x: qx, y: qy, z: qz, w: qw } = event.quaternion;
    let quat = new THREE.Quaternion(qx, qz, -qy, qw).normalize();
    if (!basis) {
      basis = quat.clone().conjugate();
    }
    cubeQuaternion.copy(quat.premultiply(basis).premultiply(HOME_ORIENTATION));
    $('#quaternion').val(`x: ${qx.toFixed(3)}, y: ${qy.toFixed(3)}, z: ${qz.toFixed(3)}, w: ${qw.toFixed(3)}`);
    if (event.velocity) {
      let { x: vx, y: vy, z: vz } = event.velocity;
      $('#velocity').val(`x: ${vx}, y: ${vy}, z: ${vz}`);
    }
  }
}

const chromaticMap = {
  "U":  "C4",
  "U'": "C#4",
  "D":  "D4",
  "D'": "D#4",
  "L":  "E4",
  "L'": "F4",
  "R":  "F#4",
  "R'": "G4",
  "F":  "G#4",
  "F'": "A4",
  "B":  "A#4",
  "B'": "B4"
}

const diatonicMapCMaj = {
  "U":  "C4",
  "U'": "D4",
  "D":  "E4",
  "D'": "F4",
  "L":  "G4",
  "L'": "A4",
  "R":  "B4",
  "R'": "C5",
  "F":  "D5",
  "F'": "E5",
  "B":  "F5",
  "B'": "G5"
}

const diatonicMapCMajPentatonic = {
  "U":  "C4",
  "U'": "D4",
  "D":  "E4",
  "D'": "G4",
  "L":  "A4",
  "L'": "C5",
  "R":  "D5",
  "R'": "E5",
  "F":  "G5",
  "F'": "A5",
  "B":  "C6",
  "B'": "D6"
}

const cPersianScale = {
  "U":  "C4",
  "U'": "C#4",
  "D":  "E4",
  "D'": "F4",
  "L":  "G4",
  "L'": "G#4",
  "R":  "C5",
  "R'": "C#5",
  "F":  "E5",
  "F'": "F5",
  "B":  "G5",
  "B'": "G#5"
}


//const diatonicMap = diatonicMapCMajPentatonic;
const diatonicMap = cPersianScale;

const scoreTimeline = [];
const timelineContainer = document.getElementById('timeline');
const NUM_BARS = 200;
const bars = new Array(NUM_BARS);

const initTimeline = function() {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < NUM_BARS; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    fragment.appendChild(bar);
    bars[i] = bar;
  }
  timelineContainer.appendChild(fragment);
}

initTimeline();

let moveIndex = 0;

const resetTimeline = function() {
  moveIndex = 0;
  document.querySelectorAll('.bar').forEach(bar => bar.style.transform = 'scaleY(0)');
}

document.querySelector('#reset-timeline').addEventListener('click', resetTimeline);

async function handleMoveEvent(event: GanCubeEvent) {
  if (event.facelets != SOLVED_STATE) {
    currentConfig = stateUpdate(currentConfig, event.move);
    console.log(1,currentConfig);
    var kpattern = faceletsToPattern(currentConfig);
    console.log(2, kpattern);
    var solution = await experimentalSolve3x3x3IgnoringCenters(kpattern);
    console.log('solution', solution);
  }
  if (musicMode === "Chromatic") {
    const freq = playNote(chromaticMap[event.move]);
    if (moveIndex++ == NUM_BARS) resetTimeline();
    bars[moveIndex].style.transform = `scaleY(${freq/1000})`;
  } else if (musicMode === "Diatonic") {
    const freq = playNote(diatonicMap[event.move]);
    if (moveIndex++ == NUM_BARS) resetTimeline();
    bars[moveIndex].style.transform = `scaleY(${freq/1000})`;
  } else if (musicMode === "Solve") {
    currentConfig = stateUpdate(currentConfig, event.move)
    const score = solvedScore(currentConfig);
    if (moveIndex++ == NUM_BARS) resetTimeline();
    // 54 is the max value, 14 seems to be the min
    bars[moveIndex].style.transform = `scaleY(${(score - 14) / 40})`;

    const scoreScale = Math.round(score / 2);
    const note = cMajorScale[scoreScale % 7];
    const octave = 3 + Math.floor(scoreScale / 7);
    const freq = frequency(note, octave);
    playFrequency(freq);
  } else {
    console.log("unknown value", musicMode);
  }

  if (timerState == "READY") {
    setTimerState("RUNNING");
  }
  twistyPlayer.experimentalAddMove(event.move, { cancel: false });
  lastMoves.push(event);

  if (timerState == "RUNNING") {
    solutionMoves.push(event);
  }
  if (lastMoves.length > 256) {
    lastMoves = lastMoves.slice(-256);
  }
  if (lastMoves.length > 10) {
    var skew = cubeTimestampCalcSkew(lastMoves);
    $('#skew').val(skew + '%');
  }
}

var cubeStateInitialized = false;

let currentConfig = "";

async function handleFaceletsEvent(event: GanCubeEvent) {
  currentConfig = event.facelets;
  if (!cubeStateInitialized) {
    if (event.facelets != SOLVED_STATE) {
      var kpattern = faceletsToPattern(event.facelets);
      var solution = await experimentalSolve3x3x3IgnoringCenters(kpattern);
      var scramble = solution.invert();
      twistyPlayer.alg = scramble;
    } else {
      twistyPlayer.alg = '';
    }
    cubeStateInitialized = true;
    console.log("Initial cube state is applied successfully", event.facelets);
  }
}

function handleCubeEvent(event: GanCubeEvent) {
  if (event.type == "GYRO") {
    handleGyroEvent(event);
  } else if (event.type == "MOVE") {
    handleMoveEvent(event);
  } else if (event.type == "FACELETS") {
    handleFaceletsEvent(event);
  } else if (event.type == "HARDWARE") {
    $('#hardwareName').val(event.hardwareName || '- n/a -');
    $('#hardwareVersion').val(event.hardwareVersion || '- n/a -');
    $('#softwareVersion').val(event.softwareVersion || '- n/a -');
    $('#productDate').val(event.productDate || '- n/a -');
    $('#gyroSupported').val(event.gyroSupported ? "YES" : "NO");
  } else if (event.type == "BATTERY") {
    $('#batteryLevel').val(event.batteryLevel + '%');
  } else if (event.type == "DISCONNECT") {
    twistyPlayer.alg = '';
    $('.info input').val('- n/a -');
    $('#connect').html('Connect');
  }
}

const customMacAddressProvider: MacAddressProvider = async (device, isFallbackCall): Promise<string | null> => {
  if (isFallbackCall) {
    return "FD:21:DE:23:B5:03";
  } else {
    return typeof device.watchAdvertisements == 'function' ? null :
      prompt('Seems like your browser does not support Web Bluetooth watchAdvertisements() API. Enable following flag in Chrome:\n\nchrome://flags/#enable-experimental-web-platform-features\n\nor enter cube MAC address manually:');
  }
};


let musicMode = "Diatonic";
$('#music-mode').on('change', function() {
    musicMode = $(this).val();
});

$('#reset-state').on('click', async () => {
  await conn?.sendCubeCommand({ type: "REQUEST_RESET" });
  twistyPlayer.alg = '';
});

$('#reset-gyro').on('click', async () => {
  basis = null;
});

$('#connect').on('click', async () => {
  if (conn) {
    conn.disconnect();
    conn = null;
  } else {
      //conn = await connectGanCube(customMacAddressProvider);
    conn = await connectGanCube(() => "FD:21:DE:23:B5:03");
    conn.events$.subscribe(handleCubeEvent);
    await conn.sendCubeCommand({ type: "REQUEST_HARDWARE" });
    await conn.sendCubeCommand({ type: "REQUEST_FACELETS" });
    await conn.sendCubeCommand({ type: "REQUEST_BATTERY" });
    $('#deviceName').val(conn.deviceName);
    $('#deviceMAC').val(conn.deviceMAC);
    $('#connect').html('Disconnect');
  }
});

var timerState: "IDLE" | "READY" | "RUNNING" | "STOPPED" = "IDLE";

function setTimerState(state: typeof timerState) {
  timerState = state;
  switch (state) {
    case "IDLE":
      stopLocalTimer();
      $('#timer').hide();
      break;
    case 'READY':
      setTimerValue(0);
      $('#timer').show();
      $('#timer').css('color', '#0f0');
      break;
    case 'RUNNING':
      solutionMoves = [];
      startLocalTimer();
      $('#timer').css('color', '#999');
      break;
    case 'STOPPED':
      stopLocalTimer();
      $('#timer').css('color', '#fff');
      var fittedMoves = cubeTimestampLinearFit(solutionMoves);
      var lastMove = fittedMoves.slice(-1).pop();
      setTimerValue(lastMove ? lastMove.cubeTimestamp! : 0);
      break;
  }
}

twistyPlayer.experimentalModel.currentPattern.addFreshListener(async (kpattern) => {
  var facelets = patternToFacelets(kpattern);
  if (facelets == SOLVED_STATE) {
    if (timerState == "RUNNING") {
      setTimerState("STOPPED");
    }
    twistyPlayer.alg = '';
  }
});

function setTimerValue(timestamp: number) {
  let t = makeTimeFromTimestamp(timestamp);
  $('#timer').html(`${t.minutes}:${t.seconds.toString(10).padStart(2, '0')}.${t.milliseconds.toString(10).padStart(3, '0')}`);
}

var localTimer: Subscription | null = null;
function startLocalTimer() {
  var startTime = now();
  localTimer = interval(30).subscribe(() => {
    setTimerValue(now() - startTime);
  });
}

function stopLocalTimer() {
  localTimer?.unsubscribe();
  localTimer = null;
}

function activateTimer() {
  if (timerState == "IDLE" && conn) {
    setTimerState("READY");
  } else {
    setTimerState("IDLE");
  }
}

$(document).on('keydown', (event) => {
  if (event.which == 32) {
    event.preventDefault();
    activateTimer();
  }
});

$("#cube").on('touchstart', () => {
  activateTimer();
});


//------------------------------

const audioCtx = new AudioContext();
const NOTE_DURATION = 2.0;

const cMajorScale = [
  'C', 'D', 'E', 'F', 'G', 'A', 'B'
];

const cMajorPentatonic = [
  'C', 'D', 'E', 'G', 'A'
];


//  'C', 'C#', 'E', 'F', 'G', 'G#', 'B'


function frequency(note: string, octave: number) {
  const m = 2 ** (octave - 4);
  switch(note) {
    case "C": return 261.63 * m; break;
    case "C#": return 277.18 * m; break;
    case "Db": return 277.18 * m; break;
    case "D": return 293.66 * m; break;
    case "D#": return 311.13 * m; break;
    case "Eb": return 311.13 * m; break;
    case "E": return 329.63 * m; break;
    case "F": return 349.23 * m; break;
    case "F#": return 369.99 * m; break;
    case "Gb": return 369.99 * m; break;
    case "G": return 392.00 * m; break;
    case "G#": return 415.30 * m; break;
    case "Ab": return 415.30 * m; break;
    case "A": return 440.00 * m; break;
    case "A#": return 466.16 * m; break;
    case "Bb": return 466.16 * m; break;
    case "B": return 493.88 * m; break;
    default: console.log('invalid note', note); return 440;
  }
}
// const frequencies = {
//   "C4": 261.63,
//   "C#4": 277.18,
//   "Db4": 277.18,
//   "D4": 293.66,
//   "D#4": 311.13,
//   "Eb4": 329.63,
//   "E4": 329.63,
//   "F4": 349.23,
//   "F#4": 369.99,
//   "Gb4": 369.99,
//   "G4": 392.00,
//   "G#4": 415.30,
//   "Ab4": 415.30,
//   "A4": 440.00,
//   "A#4": 466.16,
//   "Bb4": 466.16,
//   "B4": 493.88
// }

function playNote(note: string): number {
  const match = note.match(/^([A-G][#b]?)(\d+)$/);
  if (!match) {
    console.log('invalid note string', note);
    return 0;
  }
  const f = frequency(match[1], parseInt(match[2], 10));
  playFrequency(f);
  return f;
}

function playFrequency(f: number) {
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.frequency.setValueAtTime(f, audioCtx.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + NOTE_DURATION);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + NOTE_DURATION);
}

const solvedScore = function(cubeState: string): number {

/*
  state = array of 9x5 chars (one of URFDLB)
  "Up face" (9 chars)
  "Right face" (9 chars)
  "Front face" (9 chars)
  "Down face" (9 chars)
  "Left face" (9 chars)
  "Back face" (9 chars)

   The URFDLB chars act similar to colours, but makes it easier to tell when a
   cube is solved: "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"
*/

  /* for each face we're going to compute the max number of cubies of the same colour */
  return maxCount(cubeState.substring(0,9)) +
    maxCount(cubeState.substring(9,18)) +
    maxCount(cubeState.substring(18,27)) +
    maxCount(cubeState.substring(27,36)) +
    maxCount(cubeState.substring(36,45)) +
    maxCount(cubeState.substring(45,54));
}

const maxCount = function(str: string): number {
  const counts = {};
  let maxCount = 0;
  for (const char of str) {
    counts[char] = (counts[char] || 0) + 1;
    maxCount = Math.max(maxCount, counts[char]);
  }
  return maxCount;
}

/**
 * Apply a single face move (clockwise, prime, or double) to a 54-character
 * Kociemba facelet string (face order: U,R,F,D,L,B). Supported moves:
 * 'U','D','L','R','F','B' and their modifiers: "'", '2' (e.g., "R'", "F2").
 *
 * Example:
 * applyMoveKociemba("UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB", "U")
 * -> "UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB"
 */
function stateUpdate(state: string, move: string) {
  if (typeof state !== 'string' || state.length !== 54) {
    throw new Error('State must be a 54-character Kociemba facelet string.');
  }
  if (typeof move !== 'string' || move.length === 0) {
    throw new Error('Move must be a non-empty string like "U", "R\'", "F2".');
  }

  const face = move[0].toUpperCase();
  if (!'UDLRFB'.includes(face)) {
    throw new Error('Move face must be one of: U, D, L, R, F, B.');
  }

  const suffix = move.length > 1 ? move[1] : '';
  let turns = 1; // number of clockwise quarter-turns
  if (suffix === "'") turns = 3;
  else if (suffix === '2') turns = 2;
  else if (suffix !== '') throw new Error("Only modifiers allowed are \"'\" and '2'.");

  let out = state;
  for (let i = 0; i < turns; i++) {
    out = applyCWOnce(out, face);
  }
  return out;

  function applyCWOnce(st, f) {
    const s = st.split('');
    const t = s.slice(); // write target here

    const rotateFaceCW = (b) => {
      const map = [6, 3, 0, 7, 4, 1, 8, 5, 2];
      for (let i = 0; i < 9; i++) t[b + i] = s[b + map[i]];
    };
    const setStrip = (to, from) => {
      for (let i = 0; i < to.length; i++) t[to[i]] = s[from[i]];
    };

    switch (f) {
      case 'U': {
        rotateFaceCW(0);
        const rTop = [9, 10, 11];
        const fTop = [18, 19, 20];
        const lTop = [36, 37, 38];
        const bTop = [45, 46, 47];
        setStrip(fTop, rTop);
        setStrip(lTop, fTop);
        setStrip(bTop, lTop);
        setStrip(rTop, bTop);
        break;
      }
      case 'D': {
        rotateFaceCW(27);
        const fBot = [24, 25, 26];
        const rBot = [15, 16, 17];
        const bBot = [51, 52, 53];
        const lBot = [42, 43, 44];
        setStrip(fBot, lBot);
        setStrip(rBot, fBot);
        setStrip(bBot, rBot);
        setStrip(lBot, bBot);
        break;
      }
      case 'R': {
        rotateFaceCW(9);
        const uR = [2, 5, 8];
        const fR = [20, 23, 26];
        const dR = [29, 32, 35];
        const bL = [51, 48, 45]; // reversed to match orientation
        setStrip(fR, uR);
        setStrip(dR, fR);
        setStrip(bL, dR);
        setStrip(uR, bL);
        break;
      }
      case 'L': {
        rotateFaceCW(36);
        const uL = [0, 3, 6];
        const fL = [18, 21, 24];
        const dL = [27, 30, 33];
        const bR = [53, 50, 47]; // reversed to match orientation
        setStrip(fL, uL);
        setStrip(dL, fL);
        setStrip(bR, dL);
        setStrip(uL, bR);
        break;
      }
      case 'F': {
        rotateFaceCW(18);
        const uB = [6, 7, 8];        // U bottom row
        const rL = [9, 12, 15];      // R left col
        const dT = [29, 28, 27];     // D top row (reversed)
        const lR = [44, 41, 38];     // L right col (reversed)
        setStrip(rL, uB);
        setStrip(dT, rL);
        setStrip(lR, dT);
        setStrip(uB, lR);
        break;
      }
      case 'B': {
        rotateFaceCW(45);
        const uT = [2, 1, 0];        // U top row (reversed)
        const lL = [36, 39, 42];     // L left col
        const dB = [33, 34, 35];     // D bottom row
        const rR = [17, 14, 11];     // R right col (reversed)
        setStrip(lL, uT);
        setStrip(dB, lL);
        setStrip(rR, dB);
        setStrip(uT, rR);
        break;
      }
    }

    return t.join('');
  }
}
