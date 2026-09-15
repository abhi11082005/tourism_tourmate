import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import App from './App.jsx';
import './index.css';

/*
 * Query defaults chosen for a phone on a patchy connection:
 * - retry twice, but never on a 4xx (a 409 "this date just sold out" is an
 *   answer, not a failure, and retrying it would hammer the seat ledger).
 * - no refetch on window focus by default; the screens that need live counts
 *   (seat calendar, checkout hold) opt in individually.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = error?.status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: 0 },
  },
});

/*
 * ThemeProvider sits outside AuthProvider on purpose: the chosen theme is a
 * property of the device, not of the session, so signing out must not repaint
 * the app. AuthProvider only ever *offers* the account's saved theme to it
 * (applyRemoteTheme), and that offer is ignored when the device has its own
 * choice on record.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
