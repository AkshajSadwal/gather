import './globals.css';
import { auth } from '../auth';
import Providers from '../components/Providers';

export const metadata = {
  title: 'Gather — moments, shared',
  description: 'A calmer place to share moments and keep up with your people.'
};

export default async function RootLayout({ children }) {
  const session = await auth();
  return <html lang="en"><body><Providers session={session}>{children}</Providers></body></html>;
}
