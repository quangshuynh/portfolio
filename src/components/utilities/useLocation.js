import { useEffect, useState } from 'react';
import { currentLocation, locationChangeEvent } from '../../util/navigation';

// navigation.js handles popstate/hashchange (and its own pending history writes) and then
// announces every change of the location the app shows.
export default function useLocation() {
  const [location, setLocation] = useState(currentLocation);

  useEffect(() => {
    const updateLocation = () => setLocation(currentLocation());
    window.addEventListener(locationChangeEvent, updateLocation);
    return () => window.removeEventListener(locationChangeEvent, updateLocation);
  }, []);

  return location;
}
