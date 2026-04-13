import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Home() {
  const cookieStore = await cookies();
  const session = cookieStore.get('miranda_session');

  if (session?.value) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
