import { useCallback } from 'react';
import onMp3 from '../assets/sounds/on.mp3';
import offMp3 from '../assets/sounds/off.mp3';
import swooshMp3 from '../assets/sounds/swoosh.mp3'

export default function useClickSound() {
  const playOn = useCallback(() => {
    new Audio(onMp3).play();
  }, []);
  const playOff = useCallback(() => {
    new Audio(offMp3).play();
  }, []);
  const swoosh = useCallback(() => {
    new Audio(swooshMp3).play();
  }, []);
  return { playOn, playOff, swoosh };
}
