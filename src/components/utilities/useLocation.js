import { useEffect, useState } from 'react';
import { currentLocation, discardPendingNavigation, locationChangeEvent } from '../../util/navigation';

export default function useLocation() {
  const [location, setLocation] = useState(currentLocation);

  useEffect(() => {
    const updateLocation = () => setLocation(currentLocation());
    const browserNavigated = () => {
      discardPendingNavigation();
      updateLocation();
    };
    window.addEventListener('popstate', browserNavigated);
    window.addEventListener('hashchange', browserNavigated);
    window.addEventListener(locationChangeEvent, updateLocation);
    return () => {
      window.removeEventListener('popstate', browserNavigated);
      window.removeEventListener('hashchange', browserNavigated);
      window.removeEventListener(locationChangeEvent, updateLocation);
    };
  }, []);

  return location;
}
