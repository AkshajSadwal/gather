import AppShell from '../../components/AppShell';
import SettingsView from '../../components/SettingsView';
import { auth } from '../../auth';
import { redirect } from 'next/navigation';

export default async function SettingsPage() { const session = await auth(); if (!session?.user) redirect('/login?callbackUrl=%2Fsettings'); return <AppShell><SettingsView /></AppShell>; }
