import React from 'react';
import { useSoundSettings } from '../hooks/SoundProvider';
import useClickSound from '../hooks/useClickSound';
import sfxOff from '../assets/sfx_off.webp';
import sfxOn  from '../assets/sfx_on.webp';
import '../styles/muteButton.css';

export default function MuteButton() {
  const { muted, toggleMute } = useSoundSettings();
  const { unmute } = useClickSound();

  const handleClick = () => {
    if (muted) unmute();
    toggleMute();
  };

  return (
    <button className="mute-button" onClick={handleClick}>
      <img
        src={muted ? sfxOff : sfxOn}
        alt={muted ? 'Sound Off' : 'Sound On'}
        width={24}
        height={24}
      />
    </button>
  );
}
