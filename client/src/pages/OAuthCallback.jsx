import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const redirectUrl = searchParams.get('redirect') || '/';

    if (token) {
      // 1. Save the token to localStorage
      localStorage.setItem('tourmate.token', token);
      
      // 2. Perform a hard redirect to force the application and AuthContext 
      // to re-initialize with the new session token immediately.
      window.location.href = redirectUrl;
    } else {
      // If something went wrong, send them back to login with an error
      window.location.href = '/login?error=OAuthFailed';
    }
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sand-500">Completing sign in...</p>
    </div>
  );
}