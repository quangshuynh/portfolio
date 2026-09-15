import { useEffect, useState } from 'react';
import { locationChangeEvent } from '../../util/navigation';

export default function useLocation() {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  }));

  useEffect(() => {
    const updateLocation = () => setLocation({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    });
    window.addEventListener('popstate', updateLocation);
    window.addEventListener(locationChangeEvent, updateLocation);
    return () => {
      window.removeEventListener('popstate', updateLocation);
      window.removeEventListener(locationChangeEvent, updateLocation);
    };
  }, []);

  return location;
}
