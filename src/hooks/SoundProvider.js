import React, { createContext, useState, useContext } from 'react';

const SoundContext = createContext({
  muted: false,
  toggleMute: () => {}
});

export const useSoundSettings = () => useContext(SoundContext);

export function SoundProvider({ children }) {
  const [muted, setMuted] = useState(false);
  const toggleMute = () => setMuted(m => !m);

  return (
    <SoundContext.Provider value={{ muted, toggleMute }}>
      {children}
    </SoundContext.Provider>
  );
}
