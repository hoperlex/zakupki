import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Placeholder } from './components/Placeholder';
import { AppShell } from './layouts/AppShell';
import { PublicLayout } from './layouts/PublicLayout';
import { CatalogPage } from './features/catalog/CatalogPage';
import { CompanyCardPage } from './features/company/CompanyCardPage';
import { SupplierDashboard } from './features/supplier/SupplierDashboard';
import { SupplierTendersPage } from './features/supplier/SupplierTendersPage';
import { SecurityQueuePage } from './features/accreditation/SecurityQueuePage';
import { SupplierReviewPage } from './features/accreditation/SupplierReviewPage';
import { AdminDashboard } from './features/admin/AdminDashboard';
import { AdminTendersList } from './features/admin/AdminTendersList';
import { AdministrationPage } from './features/admin/administration/AdministrationPage';
import { CategoriesAdmin } from './features/admin/CategoriesAdmin';
import { ReferencePage } from './features/admin/reference/ReferencePage';
import { SuppliersRegistry } from './features/admin/SuppliersRegistry';
import { TenderManagePage } from './features/admin/TenderManagePage';
import { TenderWizard } from './features/admin/TenderWizard';
import { BidComparisonPage } from './features/bidding/BidComparisonPage';
import { InvitationsPage } from './features/invitations/InvitationsPage';
import { InvitePage } from './features/invitations/InvitePage';
import { SupplierMyBidsPage } from './features/supplier/SupplierMyBidsPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { TenderDetailPage } from './features/tender-detail/TenderDetailPage';

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route element={<PublicLayout />}>
        <Route index element={<CatalogPage />} />
        <Route path="tenders" element={<CatalogPage />} />
        <Route path="tenders/:id" element={<TenderDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="invite/:token" element={<InvitePage />} />
      </Route>

      {/* Supplier cabinet */}
      <Route
        path="/app"
        element={
          <ProtectedRoute roles={['supplier']}>
            <AppShell area="supplier" />
          </ProtectedRoute>
        }
      >
        <Route index element={<SupplierDashboard />} />
        <Route path="tenders" element={<SupplierTendersPage />} />
        <Route path="tenders/:id" element={<TenderDetailPage />} />
        <Route path="my-bids" element={<SupplierMyBidsPage />} />
        <Route path="company" element={<CompanyCardPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>

      {/* Manager / admin cabinet */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute roles={['manager', 'admin']}>
            <AppShell area="admin" />
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="tenders" element={<AdminTendersList />} />
        <Route path="tenders/new" element={<TenderWizard />} />
        <Route path="tenders/:id" element={<TenderManagePage />} />
        <Route path="tenders/:id/bids" element={<BidComparisonPage />} />
        <Route path="tenders/:id/invitations" element={<InvitationsPage />} />
        <Route path="suppliers" element={<SuppliersRegistry />} />
        <Route path="categories" element={<CategoriesAdmin />} />
        <Route path="reference" element={<ReferencePage />} />
        <Route
          path="administration"
          element={
            <ProtectedRoute roles={['admin']}>
              <AdministrationPage />
            </ProtectedRoute>
          }
        />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>

      {/* Security cabinet */}
      <Route
        path="/sb"
        element={
          <ProtectedRoute roles={['security']}>
            <AppShell area="security" />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="queue" replace />} />
        <Route path="queue" element={<SecurityQueuePage />} />
        <Route path="suppliers/:id" element={<SupplierReviewPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
