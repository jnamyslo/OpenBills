import React, { useState, useEffect } from 'react';
import { AppProvider, useLoading } from './context/AppContext';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { CustomerManagement } from './components/CustomerManagement';
import { InvoiceManagement } from './components/InvoiceManagement';
import { QuoteManagement } from './components/QuoteManagement';
import { QuoteEditor } from './components/QuoteEditor';
import { Settings } from './components/Settings';
import { JobManagement } from './components/JobManagement';
import { Calendar } from './components/Calendar';
import { ReportingManagement } from './components/ReportingManagement';
import { ReminderManagement } from './components/ReminderManagement';
import { DynamicColors } from './components/DynamicColors';
import { useCompany } from './context/CompanyContext';
import { useQuotes } from './context/QuoteContext';
import { usePlan } from './context/PlanContext';
import { PlanLockedNotice } from './components/PlanLockedNotice';
import { AuthProvider, useAuth } from './context/AuthContext';
import { isAdmin, parsePublicAuthRoute } from './utils/authRoutes';
import { LoginPage } from './components/LoginPage';
import { SetupPage } from './components/SetupPage';
import { AcceptInvitePage } from './components/AcceptInvitePage';
import { ForgotPasswordPage } from './components/ForgotPasswordPage';
import { ResetPasswordPage } from './components/ResetPasswordPage';

interface PageState {
  page: string;
  filter?: string;
  searchTerm?: string;
  quoteId?: string;
}

function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

/**
 * Öffentliche Auth-Routen werden vor dem Login-Gate erkannt. Die App (und damit
 * das Laden der Fachdaten im AppProvider) wird erst nach erfolgreicher Anmeldung gemountet.
 */
function AuthGate() {
  const { status, refresh } = useAuth();
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const finishOnboarding = async () => {
    await refresh();
    window.location.hash = 'dashboard';
  };

  const publicRoute = parsePublicAuthRoute(hash);
  if (publicRoute) {
    switch (publicRoute.kind) {
      case 'setup':
        return <SetupPage key={publicRoute.token} token={publicRoute.token} onDone={finishOnboarding} />;
      case 'invite':
        return <AcceptInvitePage key={publicRoute.token} token={publicRoute.token} onDone={finishOnboarding} />;
      case 'reset':
        return <ResetPasswordPage key={publicRoute.token} token={publicRoute.token} onDone={finishOnboarding} />;
      case 'forgot':
        return <ForgotPasswordPage />;
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return <LoginPage />;
  }

  return <MainApp />;
}

function MainApp() {
  const [currentPageState, setCurrentPageState] = useState<PageState>(() => {
    // Initialize from URL hash
    const hash = window.location.hash.slice(1); // Remove #
    if (hash) {
      const [page, filter, searchTerm] = hash.split('/');
      return { page: page || 'dashboard', filter, searchTerm, quoteId: filter };
    }
    return { page: 'dashboard' };
  });

  const handlePageChange = (page: string, filter?: string, searchTerm?: string) => {
    const newState = { page, filter, searchTerm, quoteId: page === 'quote-editor' ? filter : undefined };
    setCurrentPageState(newState);
    
    // Update URL hash
    let hash = page;
    if (filter) hash += `/${filter}`;
    if (searchTerm) hash += `/${searchTerm}`;
    window.location.hash = hash;
  };

  // Listen to browser back/forward buttons
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        const [page, filter, searchTerm] = hash.split('/');
        setCurrentPageState({ 
          page: page || 'dashboard', 
          filter, 
          searchTerm,
          quoteId: page === 'quote-editor' ? filter : undefined 
        });
      } else {
        setCurrentPageState({ page: 'dashboard' });
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <AppProvider>
      <AppContent currentPageState={currentPageState} handlePageChange={handlePageChange} />
    </AppProvider>
  );
}

interface AppContentProps {
  currentPageState: PageState;
  handlePageChange: (page: string, filter?: string, searchTerm?: string) => void;
}

function AppContent({ currentPageState, handlePageChange }: AppContentProps) {
  const { loading } = useLoading();
  const { company } = useCompany();
  const { quotes } = useQuotes();
  const { hasFeature } = usePlan();
  const { user } = useAuth();
  const userIsAdmin = isAdmin(user);

  // Redirect to settings when the current page's module is disabled.
  // Done as an effect (not during render) to avoid updating state while rendering.
  useEffect(() => {
    const isDisabled =
      ((currentPageState.page === 'jobs' || currentPageState.page === 'calendar') && !company.jobTrackingEnabled) ||
      ((currentPageState.page === 'quotes' || currentPageState.page === 'quote-editor') && !company.quotesEnabled) ||
      (currentPageState.page === 'reporting' && !company.reportingEnabled) ||
      (currentPageState.page === 'reminders' && !company.remindersEnabled);

    if (isDisabled) {
      handlePageChange(userIsAdmin ? 'settings' : 'dashboard');
    }
  }, [
    userIsAdmin,
    currentPageState.page,
    company.jobTrackingEnabled,
    company.quotesEnabled,
    company.reportingEnabled,
    company.remindersEnabled,
    handlePageChange,
  ]);

  const renderPage = () => {
    // Show loading state while data is being fetched
    if (loading) {
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Lade Daten...</p>
          </div>
        </div>
      );
    }

    switch (currentPageState.page) {
      case 'dashboard':
        return <Dashboard onNavigate={handlePageChange} />;
      case 'customers':
        return <CustomerManagement />;
      case 'jobs':
        // Disabled if job tracking is not enabled; effect above redirects to settings
        if (!company.jobTrackingEnabled) {
          return null;
        }
        if (!hasFeature('jobs')) {
          return <PlanLockedNotice feature="jobs" />;
        }
        return <JobManagement onNavigate={handlePageChange} />;
      case 'calendar':
        // Disabled if job tracking is not enabled; effect above redirects to settings
        if (!company.jobTrackingEnabled) {
          return null;
        }
        if (!hasFeature('jobs')) {
          return <PlanLockedNotice feature="jobs" />;
        }
        return <Calendar onNavigate={handlePageChange} />;
      case 'invoices':
        return <InvoiceManagement initialFilter={currentPageState.filter} initialSearchTerm={currentPageState.searchTerm} onNavigate={handlePageChange} />;
      case 'quotes':
        // Disabled if quotes module is not enabled; effect above redirects to settings
        if (!company.quotesEnabled) {
          return null;
        }
        return <QuoteManagement onNavigate={handlePageChange} />;
      case 'quote-editor': {
        // Disabled if quotes module is not enabled; effect above redirects to settings
        if (!company.quotesEnabled) {
          return null;
        }
        const quoteToEdit = currentPageState.quoteId
          ? quotes.find(q => q.id === currentPageState.quoteId) || null
          : null;
        return <QuoteEditor
          quote={quoteToEdit}
          onClose={() => handlePageChange('quotes')}
          onNavigateToCustomers={() => handlePageChange('customers')}
          onNavigateToSettings={() => handlePageChange('settings')}
        />;
      }
      case 'reporting':
        // Disabled if reporting is not enabled; effect above redirects to settings
        if (!company.reportingEnabled) {
          return null;
        }
        return <ReportingManagement />;
      case 'reminders':
        // Disabled if reminders module is not enabled; effect above redirects to settings
        if (!company.remindersEnabled) {
          return null;
        }
        if (!hasFeature('reminders')) {
          return <PlanLockedNotice feature="reminders" />;
        }
        return <ReminderManagement />;
      case 'settings':
        return userIsAdmin ? <Settings /> : <Dashboard onNavigate={handlePageChange} />;
      default:
        return <Dashboard onNavigate={handlePageChange} />;
    }
  };

  return (
    <>
      <DynamicColors />
      <Layout currentPage={currentPageState.page} onPageChange={(page) => handlePageChange(page)}>
        {renderPage()}
      </Layout>
    </>
  );
}

export default App;