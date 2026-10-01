import AppShell from '../../components/AppShell';
import MessagesView from '../../components/MessagesView';
import { auth } from '../../auth';
import { redirect } from 'next/navigation';

export default async function MessagesPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect('/login?callbackUrl=%2Fmessages');
  const params = await searchParams;
  return <AppShell><MessagesView initialTo={params?.to || ''} /></AppShell>;
}
