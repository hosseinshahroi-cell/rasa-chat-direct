import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack,
  type ICameraVideoTrack,
  type IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";

export interface AgoraSession {
  channel: string;
  client: IAgoraRTCClient;
  mic: IMicrophoneAudioTrack | null;
  cam: ICameraVideoTrack | null;
  remoteAudio: Map<string, IRemoteAudioTrack>;
  joined: boolean;
}

let current: AgoraSession | null = null;
// serializes every acquire/release so two mounts can never join at once
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function getSession(): AgoraSession | null {
  return current;
}

/**
 * Returns the live session for this channel, or creates a fresh one.
 * Any session for a different channel is fully torn down first.
 */
export function acquireSession(channel: string): Promise<AgoraSession> {
  return serialize(async () => {
    if (current && current.channel === channel) return current;
    if (current) await teardown(current);
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    current = { channel, client, mic: null, cam: null, remoteAudio: new Map(), joined: false };
    return current;
  });
}

export function releaseSession(channel: string): Promise<void> {
  return serialize(async () => {
    if (!current || current.channel !== channel) return;
    const s = current;
    current = null;
    await teardown(s);
  });
}

async function teardown(s: AgoraSession) {
  try {
    for (const t of s.remoteAudio.values()) {
      try { t.stop(); } catch { /* noop */ }
    }
    s.remoteAudio.clear();
    if (s.mic) {
      try { s.mic.stop(); } catch { /* noop */ }
      try { s.mic.getMediaStreamTrack().stop(); } catch { /* noop */ }
      try { s.mic.close(); } catch { /* noop */ }
      s.mic = null;
    }
    if (s.cam) {
      try { s.cam.stop(); } catch { /* noop */ }
      try { s.cam.getMediaStreamTrack().stop(); } catch { /* noop */ }
      try { s.cam.close(); } catch { /* noop */ }
      s.cam = null;
    }
    try { s.client.removeAllListeners(); } catch { /* noop */ }
    if (s.joined) {
      try { await s.client.leave(); } catch { /* noop */ }
      s.joined = false;
    }
  } catch { /* noop */ }
}

/** Single microphone capture with AEC / NS / AGC guaranteed on the device track. */
export async function createProcessedMic(): Promise<IMicrophoneAudioTrack> {
  const mic = await AgoraRTC.createMicrophoneAudioTrack({
    encoderConfig: { sampleRate: 48000, stereo: false, bitrate: 32 },
    AEC: true,
    ANS: true,
    AGC: true,
  });
  const raw = mic.getMediaStreamTrack();
  const constraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  try {
    await raw.applyConstraints(constraints);
  } catch {
    /* browser refused re-apply; agora flags are already set */
  }
  // never route our own mic to the local speaker – primary echo source
  try { mic.stop(); } catch { /* noop */ }
  return mic;
}

/** Plays a remote audio track, stopping any previous track of the same user. */
export function playRemoteAudio(s: AgoraSession, uid: string, track: IRemoteAudioTrack | undefined) {
  if (!track) return;
  const prev = s.remoteAudio.get(uid);
  if (prev && prev !== track) {
    try { prev.stop(); } catch { /* noop */ }
  }
  if (prev === track) return;
  s.remoteAudio.set(uid, track);
  try { track.play(); } catch { /* noop */ }
}

export function stopRemoteAudio(s: AgoraSession, uid: string) {
  const t = s.remoteAudio.get(uid);
  if (t) {
    try { t.stop(); } catch { /* noop */ }
    s.remoteAudio.delete(uid);
  }
}
