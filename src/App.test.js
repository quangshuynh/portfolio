import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

test('renders Quang Huynh’s software engineering portfolio', () => {
  render(<App />);
  expect(screen.getByText('Hi, I’m Quang.')).toBeInTheDocument();
  expect(
  screen.getByRole('heading', {
    name: 'I build reliable backend systems, developer tools, automation, and native applications.'
  })
).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Business Data Automation' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '585Dashcam585' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open 585Dashcam585 live site' })).toHaveAttribute('href', 'https://www.585dashcam585.com');
  expect(screen.getByRole('heading', { name: 'Experience' })).toBeInTheDocument();
  expect(screen.getByText('GPA: 3.42 / 4.00')).toBeInTheDocument();
  expect(screen.queryByText(/GPA: 3\.68/)).not.toBeInTheDocument();
  expect(screen.getByText('“He was able to work with greater independence than is expected of co-ops.”')).toBeInTheDocument();
  expect(screen.getByText('Matt Telesky, Director of Software Engineering')).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { name: 'Business Data Automation' })).toHaveLength(1);
  expect(screen.getAllByRole('heading', { name: 'GitProfileLens' })).toHaveLength(1);
  expect(screen.getAllByRole('heading', { name: 'ScribeKit' })).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: 'Steam Value Lookup' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Hymical Forms' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'CaseNotes' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Repo Radar' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'mover-git' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Foody' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'SalonFlow' })).not.toBeInTheDocument();
  const moreProjectsToggle = screen.getByRole('button', { name: 'View more projects' });
  expect(moreProjectsToggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(moreProjectsToggle);
  expect(screen.getByRole('heading', { name: '585photo585' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open 585photo585 live site' })).toHaveAttribute('href', 'https://www.585photo585.com');
  expect(screen.queryByRole('link', { name: 'Open 585photo585 repository' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Foody' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'SalonFlow' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'mover-git' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Steam Value Lookup' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show fewer projects' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/firebase authentication and cloud firestore/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Foody live demo' })).toHaveAttribute('href', 'https://foody-rit.web.app/');
  expect(screen.getByRole('link', { name: 'Open CaseNotes documentation' })).toHaveAttribute('href', 'https://quangshuynh.github.io/casenotes/');
  expect(screen.getByRole('link', { name: 'Open Steam Value Lookup live demo' })).toHaveAttribute('href', 'https://steam-value-lookup.onrender.com/');
  expect(screen.getByRole('img', { name: 'Foody project logo' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Hymical Forms repository' })).toHaveAttribute('href', 'https://github.com/hymical/forms');
  fireEvent.click(screen.getByRole('button', { name: 'Show fewer projects' }));
  expect(screen.queryByRole('heading', { name: 'Foody' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'SalonFlow' })).not.toBeInTheDocument();
  expect(screen.getByText(/52 pytest tests/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open GitProfileLens live demo' })).toHaveAttribute('href', 'https://gitprofilelens.vercel.app/');
  expect(screen.getByRole('link', { name: 'View GitProfileLens code' })).toHaveAttribute('href', 'https://github.com/quangshuynh/gitprofilelens');
  const businessGallery = within(screen.getByLabelText('Business Data Automation gallery'));
  expect(businessGallery.getByRole('button', { name: 'Architecture' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(businessGallery.getByRole('button', { name: 'Dashboard' }));
  expect(businessGallery.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('img', { name: /Business Data Automation reconciliation dashboard/i })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'GitProfileLens project logo' })).toBeInTheDocument();
  fireEvent.click(within(screen.getByLabelText('GitProfileLens gallery')).getByRole('button', { name: 'Results' }));
  expect(screen.getByRole('img', { name: /GitProfileLens audit dashboard/i })).toBeInTheDocument();
  const scribeKitGallery = within(screen.getByLabelText('ScribeKit gallery'));
  expect(scribeKitGallery.getByRole('button', { name: 'Logo' })).toHaveAttribute('aria-pressed', 'true');
  expect(scribeKitGallery.getAllByRole('button').map((button) => button.textContent)).toEqual(['Logo', 'App', 'Transcript']);
  expect(screen.getByRole('img', { name: 'ScribeKit app logo' })).toBeInTheDocument();
  fireEvent.click(scribeKitGallery.getByRole('button', { name: 'App' }));
  expect(scribeKitGallery.getByRole('button', { name: 'App' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('img', { name: /ScribeKit macOS meeting window/i })).toBeInTheDocument();
  fireEvent.click(scribeKitGallery.getByRole('button', { name: 'Transcript' }));
  expect(scribeKitGallery.getByRole('button', { name: 'Transcript' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('img', { name: 'ScribeKit timestamped Markdown transcript output' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open ScribeKit documentation' })).toHaveAttribute('href', 'https://quangshuynh.github.io/scribekit/');
  expect(screen.getByRole('img', { name: 'Repo Radar project logo' })).toBeInTheDocument();
  const themeToggle = screen.getByRole('button', { name: 'Switch to light mode' });
  fireEvent.click(themeToggle);
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
});

test('home page project screenshots open in the lightbox and restore focus', async () => {
  render(<App />);
  const trigger = screen.getByRole('button', { name: 'Open image: 585Dashcam585 storefront' });

  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Image viewer: 585Dashcam585 storefront' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close image viewer' })).toHaveFocus();

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole('dialog', { name: 'Image viewer: 585Dashcam585 storefront' })).not.toBeInTheDocument();
});

test('renders the dedicated About Quang route with working homepage links', () => {
  window.history.pushState({}, '', '/about');
  render(<App />);

  expect(screen.getByRole('heading', { name: 'Hi, I’m Quang.' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Beyond software' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'How I approach engineering' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/#about');
  expect(screen.getByRole('img', { name: /golden sunset clouds/i })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /blue classic sports car/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View more photos of Quang' }));
  const personalGallery = screen.getByLabelText('More photos of Quang');
  expect(personalGallery.querySelectorAll('img')).toHaveLength(3);
  expect(within(personalGallery).getByRole('img', { name: /shoreline at sunset/i })).toHaveAttribute('loading', 'lazy');
  fireEvent.click(screen.getByRole('button', { name: 'Close personal photo gallery' }));
  expect(screen.queryByRole('dialog', { name: 'More about Quang' })).not.toBeInTheDocument();
  const photographyCard = screen.getByRole('heading', { name: 'Photography' }).closest('article');
  const photographyToggle = within(photographyCard).getByRole('button', { name: 'View more' });
  expect(screen.queryByLabelText('More photographs by Quang')).not.toBeInTheDocument();
  fireEvent.click(photographyToggle);
  expect(screen.getByLabelText('More photographs by Quang')).toBeInTheDocument();
  expect(screen.getAllByLabelText('More photographs by Quang')[0].querySelectorAll('img')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'View all' }));
  expect(screen.getAllByLabelText('More photographs by Quang')[0].querySelectorAll('img')).toHaveLength(18);
  expect(screen.getByRole('img', { name: /church spire/i })).toHaveAttribute('loading', 'lazy');
  fireEvent.click(screen.getByRole('button', { name: 'Close photography gallery' }));
  expect(screen.queryByRole('dialog', { name: 'Photography by Quang' })).not.toBeInTheDocument();
  const carsCard = screen.getByRole('heading', { name: 'Cars & technology' }).closest('article');
  expect(within(carsCard).queryByRole('img', { name: /computer hardware/i })).not.toBeInTheDocument();
  fireEvent.click(within(carsCard).getByRole('button', { name: 'View more' }));
  expect(screen.getByRole('dialog', { name: 'Cars & technology' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /computer hardware/i })).toBeInTheDocument();
  expect(screen.getByLabelText('More cars and technology photos').querySelectorAll('img')).toHaveLength(5);
  expect(screen.getByRole('img', { name: /Singer Porsche/i })).toHaveAttribute('loading', 'lazy');
  fireEvent.click(screen.getByRole('button', { name: 'Close cars and technology gallery' }));
  expect(screen.getByRole('link', { name: /View my work/i })).toHaveAttribute('href', '/#projects');
  expect(document.title).toBe('Quang Huynh | About Quang');

  window.history.pushState({}, '', '/');
});
