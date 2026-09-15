import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * The payment boundary. Guests browse everything; they are only stopped here,
 * and they are sent back to exactly where they were once they sign in — losing a
 * configured cart at the login wall is what kills conversion.
 *
 * Works either as a wrapper (`<RequireAuth><Checkout /></RequireAuth>`) or as a
 * layout route element, in which case it renders the matched child route.
 */
export default function RequireAuth({ children, role }) {
  const { status, isGuest, user } = useAuth();
  const location = useLocation();

  // A stored token is still being checked — don't flash the login screen.
  if (status === 'restoring') {
    return (
      <p className="faint p-8 text-center text-sm" role="status">
        Restoring your session…
      </p>
    );
  }

  if (isGuest) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (role && user.role !== role) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold">Not your desk</h2>
        <p className="muted mt-1 text-sm">This area is for {role.toLowerCase()} accounts.</p>
      </div>
    );
  }

  return children ?? <Outlet />;
}
