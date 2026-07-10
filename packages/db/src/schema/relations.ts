import { relations } from 'drizzle-orm';
import {
  accreditationReviews,
  authRefreshTokens,
  bidHistory,
  bidItems,
  bids,
  categories,
  categorySubscriptions,
  files,
  invitations,
  notifications,
  organizations,
  tenderPositions,
  tenders,
  users,
} from './tables';

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  bids: many(bids),
  accreditationReviews: many(accreditationReviews),
  subscriptions: many(categorySubscriptions),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  refreshTokens: many(authRefreshTokens),
  notifications: many(notifications),
}));

export const accreditationReviewsRelations = relations(accreditationReviews, ({ one }) => ({
  organization: one(organizations, {
    fields: [accreditationReviews.organizationId],
    references: [organizations.id],
  }),
  reviewer: one(users, {
    fields: [accreditationReviews.reviewerId],
    references: [users.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  tenders: many(tenders),
}));

export const tendersRelations = relations(tenders, ({ one, many }) => ({
  category: one(categories, {
    fields: [tenders.categoryId],
    references: [categories.id],
  }),
  organization: one(organizations, {
    fields: [tenders.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [tenders.createdBy],
    references: [users.id],
  }),
  positions: many(tenderPositions),
  bids: many(bids),
  invitations: many(invitations),
}));

export const tenderPositionsRelations = relations(tenderPositions, ({ one, many }) => ({
  tender: one(tenders, {
    fields: [tenderPositions.tenderId],
    references: [tenders.id],
  }),
  bidItems: many(bidItems),
}));

export const bidsRelations = relations(bids, ({ one, many }) => ({
  tender: one(tenders, {
    fields: [bids.tenderId],
    references: [tenders.id],
  }),
  supplierOrg: one(organizations, {
    fields: [bids.supplierOrgId],
    references: [organizations.id],
  }),
  items: many(bidItems),
  history: many(bidHistory),
}));

export const bidItemsRelations = relations(bidItems, ({ one }) => ({
  bid: one(bids, {
    fields: [bidItems.bidId],
    references: [bids.id],
  }),
  position: one(tenderPositions, {
    fields: [bidItems.positionId],
    references: [tenderPositions.id],
  }),
}));

export const bidHistoryRelations = relations(bidHistory, ({ one }) => ({
  bid: one(bids, {
    fields: [bidHistory.bidId],
    references: [bids.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  tender: one(tenders, {
    fields: [invitations.tenderId],
    references: [tenders.id],
  }),
}));

export const filesRelations = relations(files, ({ one }) => ({
  uploader: one(users, {
    fields: [files.uploadedBy],
    references: [users.id],
  }),
}));
