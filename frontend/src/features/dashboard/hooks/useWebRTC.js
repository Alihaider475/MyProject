import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../../api/client.js';

export function useWebRTC(videoRef, onError) {
  const pcRef = useRef(null);

  const stop = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [videoRef]);

  const start = useCallback(async (cameraId) => {
    stop();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pcRef.current = pc;

    pc.ontrack = (evt) => {
      if (videoRef.current && evt.streams[0]) {
        videoRef.current.srcObject = evt.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        stop();
        onError?.('WebRTC ' + pc.connectionState);
      }
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to finish so the SDP contains all candidates.
    // This is simpler and more reliable than trickle ICE, especially on localhost.
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onStateChange);
      setTimeout(resolve, 5000); // safety timeout
    });

    if (pcRef.current !== pc) return; // was stopped mid-gather

    const { sdp, type } = await api.webrtcOffer(
      cameraId,
      pc.localDescription.sdp,
      pc.localDescription.type,
    );
    await pc.setRemoteDescription(new RTCSessionDescription({ sdp, type }));
  }, [videoRef, stop, onError]);

  useEffect(() => () => stop(), [stop]);

  return { start, stop };
}
