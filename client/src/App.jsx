import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import Home from './pages/Home.jsx';
import TourDetail from './pages/TourDetail.jsx';
import Login from './pages/Login.jsx';

/*
 * Route table. Public routes are imported eagerly because they are the first
 * paint for almost every visitor; the authenticated and admin screens are split
 * out so a guest never downloads the admin console.
 *
 * The dashboard is one nested route with the shell as its element, so the sidebar
 * is mounted once and only the panel inside it changes. Its modules are lazy
 * individually — the PDF and support screens are the least visited and the
 * heaviest, and there is no reason to pay for them on the Overview.
 *
 * /bookings and /wishlist now live inside the dashboard. The old paths redirect
 * rather than 404, because they are in browser histories and shared links.
 */

const Explore = lazy(() => import('./pages/Explore.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Overview = lazy(() => import('./pages/dashboard/Overview.jsx'));
const Profile = lazy(() => import('./pages/dashboard/Profile.jsx'));
const Preferences = lazy(() => import('./pages/dashboard/Preferences.jsx'));
const Reviews = lazy(() => import('./pages/dashboard/Reviews.jsx'));
const Documents = lazy(() => import('./pages/dashboard/Documents.jsx'));
const Payments = lazy(() => import('./pages/dashboard/Payments.jsx'));
const Support = lazy(() => import('./pages/dashboard/Support.jsx'));
const MyBookings = lazy(() => import('./pages/MyBookings.jsx'));
const Wishlist = lazy(() => import('./pages/Wishlist.jsx'));
import OAuthCallback from './pages/OAuthCallback.jsx'; // Adjust import path

// Inside your <Routes> block in App.jsx...


const Loading = () => (
  <p className="faint py-16 text-center text-sm" role="status">
    Loading…
  </p>
);

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          {/* Guest mode: everything up to the payment step. */}
          <Route index element={<Home />} />
          <Route path="tours/:slug" element={<TourDetail />} />
          <Route path="explore" element={<Explore />} />
          <Route path="login" element={<Login />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />

          {/* The login wall starts here and nowhere earlier. */}
          <Route element={<RequireAuth />}>
            <Route path="checkout/:bookingId" element={<Checkout />} />

            <Route path="dashboard" element={<Dashboard />}>
              <Route index element={<Overview />} />
              <Route path="profile" element={<Profile />} />
              <Route path="trips" element={<MyBookings />} />
              <Route path="saved" element={<Wishlist />} />
              <Route path="reviews" element={<Reviews />} />
              <Route path="documents" element={<Documents />} />
              <Route path="payments" element={<Payments />} />
              <Route path="support" element={<Support />} />
              <Route path="preferences" element={<Preferences />} />
            </Route>
          </Route>

          {/* Where these lists used to live. */}
          <Route path="bookings" element={<Navigate to="/dashboard/trips" replace />} />
          <Route path="wishlist" element={<Navigate to="/dashboard/saved" replace />} />

          <Route element={<RequireAuth role="ADMIN" />}>
            <Route path="admin" element={<AdminDashboard />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
