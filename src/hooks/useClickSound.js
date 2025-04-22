import { useCallback } from 'react';
import onMp3     from '../assets/sounds/on.mp3';
import offMp3    from '../assets/sounds/off.mp3';
import swooshMp3 from '../assets/sounds/swoosh.mp3';
import unmuteMp3 from '../assets/sounds/unmute.mp3';
import { useSoundSettings } from './SoundProvider';

export default function useClickSound() {
  const { muted } = useSoundSettings();

  const playOn = useCallback(() => {
    if (!muted) new Audio(onMp3).play();
  }, [muted]);

  const playOff = useCallback(() => {
    if (!muted) new Audio(offMp3).play();
  }, [muted]);

  const swoosh = useCallback(() => {
    if (!muted) new Audio(swooshMp3).play();
  }, [muted]);

  const unmute = useCallback(() => {
    new Audio(unmuteMp3).play();
  }, []);

  return { playOn, playOff, swoosh, unmute };
}
