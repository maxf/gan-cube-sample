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

async function amimateCubeOrientation(time) {
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


async function handleMoveEvent(event: GanCubeEvent) {
  if (musicMode === "Chromatic") {
    const freq = playNote(chromaticMap[event.move]);
  } else if (musicMode === "Diatonic") {
    const freq = playNote(diatonicMap[event.move]);
  } else {
    console.error("unknown value", musicMode);
  }

  twistyPlayer.experimentalAddMove(event.move, { cancel: false });
  lastMoves.push(event);

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
    //console.log("Initial cube state is applied successfully", event.facelets);
  }
}

function handleCubeEvent(event: GanCubeEvent) {
  if (event.type == "MOVE") {
    handleMoveEvent(event);
  } else if (event.type == "FACELETS") {
    handleFaceletsEvent(event);
  } else if (event.type == "HARDWARE") {
    $('#hardwareName').val(event.hardwareName || '- n/a -');
    $('#hardwareVersion').val(event.hardwareVersion || '- n/a -');
    $('#softwareVersion').val(event.softwareVersion || '- n/a -');
    $('#productDate').val(event.productDate || '- n/a -');
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

$('#reset-state').on('click', async () => {
  await conn?.sendCubeCommand({ type: "REQUEST_RESET" });
  twistyPlayer.alg = '';
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


twistyPlayer.experimentalModel.currentPattern.addFreshListener(async (kpattern) => {
  var facelets = patternToFacelets(kpattern);
  if (facelets == SOLVED_STATE) {
    twistyPlayer.alg = '';
  }
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
    default: console.error('invalid note', note); return 440;
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
    console.error('invalid note string', note);
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


const maxCount = function(str: string): number {
  const counts = {};
  let maxCount = 0;
  for (const char of str) {
    counts[char] = (counts[char] || 0) + 1;
    maxCount = Math.max(maxCount, counts[char]);
  }
  return maxCount;
}
