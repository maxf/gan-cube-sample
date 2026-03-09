
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

/* Moves */
// U:  UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB
//     UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB
//              ^^^      ^^^               ^^^      ^^^
//               4        1                 2        3

// U': UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB
//     UUUUUUUUUFFFRRRRRRLLLFFFFFFDDDDDDDDDBBBLLLLLLRRRBBBBBB
//              ^^^      ^^^               ^^^      ^^^

//



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

const diatonicMap = {
  "U":  "C4",
  "U'": "D4",
  "D":  "E4",
  "D'": "F4",
  "L":  "G4",
  "L'": "A4",
  "R":  "B4",
  "R'": "C4",
  "F":  "D4",
  "F'": "E4",
  "B":  "F4",
  "B'": "G4"
}

const scoreTimeline = [];

async function handleMoveEvent(event: GanCubeEvent) {
  switch (musicMode) {
    case "Chromatic":
      playNote(chromaticMap[event.move]);
      break;
    case "Diatonic":
      playNote(diatonicMap[event.move]);
      break;
    case "Solve":
      // console.log(event)
      // const score = solvedScore(currentConfig);
      // console.log("config", currentConfig)
      // console.log("score", score)
      // console.log("event.move", event.move)
      // scoreTimeline.push(score)
      // //      console.log(scoreTimeline)
      // const f = (score-10)/44*(494-261)+261;
      // console.log(score, f);
      // playFrequency((score-10)/44*(494-261)+261);

    default:
      break;
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

  if (musicMode === "Solve") {
    const score = solvedScore(currentConfig);
    console.log("config", currentConfig)
    console.log("score", score)
    console.log("event.move", event.move)
    scoreTimeline.push(score)
    //      console.log(scoreTimeline)
    const f = (score-10)/44*(494-261)+261;
    console.log(score, f);
    playFrequency((score-10)/44*(494-261)+261);
  }


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


let musicMode = "Solve";
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

function frequency(note: string) {
  switch(note) {
    case "C4": return 261.63;
    case "C#4": return 277.18;
    case "D4": return 293.66;
    case "D#4": return 311.13;
    case "E4": return 329.63;
    case "F4": return 349.23;
    case "F#4": return 369.99;
    case "G4": return 392.00;
    case "G#4": return 415.30;
    case "A4": return 440.00;
    case "A#4": return 466.16;
    case "B4": return 493.88;
    default: return 100;
  }
}

function playNote(note: string) {
  const f = frequency(note);
  playFrequency(f);
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
