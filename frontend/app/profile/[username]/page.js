import AppShell from '../../../components/AppShell';
import ProfileView from '../../../components/ProfileView';

export default async function ProfilePage({ params }) {
  const { username } = await params;
  return <AppShell><ProfileView username={username} /></AppShell>;
}
