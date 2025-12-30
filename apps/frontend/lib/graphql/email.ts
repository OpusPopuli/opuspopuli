import { gql } from "@apollo/client";

// ============================================
// Types
// ============================================

export type EmailType =
  | "WELCOME"
  | "REPRESENTATIVE_CONTACT"
  | "CIVIC_UPDATE"
  | "ELECTION_REMINDER"
  | "BALLOT_UPDATE"
  | "ACCOUNT_ACTIVITY";

export type EmailStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "BOUNCED";

export interface EmailCorrespondence {
  id: string;
  emailType: EmailType;
  status: EmailStatus;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  bodyPreview?: string;
  representativeId?: string;
  representativeName?: string;
  propositionId?: string;
  propositionTitle?: string;
  errorMessage?: string;
  sentAt?: string;
  createdAt: string;
}

export interface PaginatedEmailCorrespondence {
  items: EmailCorrespondence[];
  total: number;
  hasMore: boolean;
}

export interface SendEmailResult {
  success: boolean;
  correspondenceId?: string;
  error?: string;
}

export interface ContactRepresentativeInput {
  representativeId: string;
  subject: string;
  message: string;
  propositionId?: string;
  includeAddress?: boolean;
}

export interface RepresentativeInfoInput {
  id: string;
  name: string;
  email: string;
  chamber?: string;
}

export interface PropositionInfoInput {
  id: string;
  title: string;
}

// ============================================
// Query Response Types
// ============================================

export interface EmailHistoryData {
  myEmailHistory: PaginatedEmailCorrespondence;
}

export interface EmailData {
  myEmail: EmailCorrespondence | null;
}

export interface MailtoLinkData {
  representativeMailtoLink: string;
}

// ============================================
// Mutation Response Types
// ============================================

export interface ContactRepresentativeData {
  contactRepresentative: SendEmailResult;
}

// ============================================
// Queries
// ============================================

export const GET_EMAIL_HISTORY = gql`
  query GetEmailHistory($skip: Int, $take: Int, $emailType: EmailType) {
    myEmailHistory(skip: $skip, take: $take, emailType: $emailType) {
      items {
        id
        emailType
        status
        recipientEmail
        recipientName
        subject
        bodyPreview
        representativeId
        representativeName
        propositionId
        propositionTitle
        errorMessage
        sentAt
        createdAt
      }
      total
      hasMore
    }
  }
`;

export const GET_EMAIL = gql`
  query GetEmail($id: ID!) {
    myEmail(id: $id) {
      id
      emailType
      status
      recipientEmail
      recipientName
      subject
      bodyPreview
      representativeId
      representativeName
      propositionId
      propositionTitle
      errorMessage
      sentAt
      createdAt
    }
  }
`;

export const GET_MAILTO_LINK = gql`
  query GetMailtoLink(
    $representativeEmail: String!
    $subject: String!
    $body: String!
  ) {
    representativeMailtoLink(
      representativeEmail: $representativeEmail
      subject: $subject
      body: $body
    )
  }
`;

// ============================================
// Mutations
// ============================================

export const CONTACT_REPRESENTATIVE = gql`
  mutation ContactRepresentative(
    $input: ContactRepresentativeDto!
    $representative: RepresentativeInfoDto!
    $proposition: PropositionInfoDto
  ) {
    contactRepresentative(
      input: $input
      representative: $representative
      proposition: $proposition
    ) {
      success
      correspondenceId
      error
    }
  }
`;
