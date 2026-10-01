import AppShell from '../../components/AppShell';
import SearchView from '../../components/SearchView';

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  return <AppShell><SearchView initialQuery={params?.q || ''} /></AppShell>;
}
