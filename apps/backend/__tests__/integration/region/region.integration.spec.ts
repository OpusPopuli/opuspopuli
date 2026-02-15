/**
 * Region Integration Tests
 *
 * Tests region/civic data operations against real database and GraphQL endpoints.
 * Covers Representatives, Propositions, Meetings, and Campaign Finance entities.
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createRepresentative,
  createProposition,
  createMeeting,
  createCommittee,
  createContribution,
  createExpenditure,
  createIndependentExpenditure,
  getDbService,
  graphqlRequest,
  assertNoErrors,
} from '../utils';

// GraphQL Queries
const REGION_INFO_QUERY = `
  query {
    regionInfo {
      id
      name
      description
      timezone
      supportedDataTypes
    }
  }
`;

const buildRepresentativesQuery = (skip = 0, take = 10, chamber?: string) => `
  query {
    representatives(skip: ${skip}, take: ${take}${chamber ? `, chamber: "${chamber}"` : ''}) {
      items {
        id
        externalId
        name
        chamber
        district
        party
        photoUrl
        contactInfo {
          email
          phone
          website
        }
      }
      total
      hasMore
    }
  }
`;

const buildRepresentativeByIdQuery = (id: string) => `
  query {
    representative(id: "${id}") {
      id
      externalId
      name
      chamber
      district
      party
    }
  }
`;

const buildPropositionsQuery = (skip = 0, take = 10) => `
  query {
    propositions(skip: ${skip}, take: ${take}) {
      items {
        id
        externalId
        title
        summary
        fullText
        status
        electionDate
      }
      total
      hasMore
    }
  }
`;

const buildPropositionByIdQuery = (id: string) => `
  query {
    proposition(id: "${id}") {
      id
      externalId
      title
      summary
      status
    }
  }
`;

const buildMeetingsQuery = (skip = 0, take = 10) => `
  query {
    meetings(skip: ${skip}, take: ${take}) {
      items {
        id
        externalId
        title
        body
        scheduledAt
        location
        agendaUrl
        videoUrl
      }
      total
      hasMore
    }
  }
`;

const buildMeetingByIdQuery = (id: string) => `
  query {
    meeting(id: "${id}") {
      id
      externalId
      title
      body
      scheduledAt
      location
    }
  }
`;

// Campaign Finance Query Builders
const buildCommitteesQuery = (skip = 0, take = 10, sourceSystem?: string) => `
  query {
    committees(skip: ${skip}, take: ${take}${sourceSystem ? `, sourceSystem: "${sourceSystem}"` : ''}) {
      items {
        id
        externalId
        name
        type
        candidateName
        candidateOffice
        propositionId
        party
        status
        sourceSystem
        sourceUrl
      }
      total
      hasMore
    }
  }
`;

const buildCommitteeByIdQuery = (id: string) => `
  query {
    committee(id: "${id}") {
      id
      externalId
      name
      type
      status
      sourceSystem
    }
  }
`;

const buildContributionsQuery = (
  skip = 0,
  take = 10,
  committeeId?: string,
  sourceSystem?: string,
) => `
  query {
    contributions(skip: ${skip}, take: ${take}${committeeId ? `, committeeId: "${committeeId}"` : ''}${sourceSystem ? `, sourceSystem: "${sourceSystem}"` : ''}) {
      items {
        id
        externalId
        committeeId
        donorName
        donorType
        amount
        date
        sourceSystem
      }
      total
      hasMore
    }
  }
`;

const buildContributionByIdQuery = (id: string) => `
  query {
    contribution(id: "${id}") {
      id
      externalId
      committeeId
      donorName
      donorType
      amount
      date
      sourceSystem
    }
  }
`;

const buildExpendituresQuery = (
  skip = 0,
  take = 10,
  committeeId?: string,
  sourceSystem?: string,
) => `
  query {
    expenditures(skip: ${skip}, take: ${take}${committeeId ? `, committeeId: "${committeeId}"` : ''}${sourceSystem ? `, sourceSystem: "${sourceSystem}"` : ''}) {
      items {
        id
        externalId
        committeeId
        payeeName
        amount
        date
        sourceSystem
      }
      total
      hasMore
    }
  }
`;

const buildExpenditureByIdQuery = (id: string) => `
  query {
    expenditure(id: "${id}") {
      id
      externalId
      committeeId
      payeeName
      amount
      date
      sourceSystem
    }
  }
`;

const buildIndependentExpendituresQuery = (
  skip = 0,
  take = 10,
  committeeId?: string,
  supportOrOppose?: string,
  sourceSystem?: string,
) => `
  query {
    independentExpenditures(skip: ${skip}, take: ${take}${committeeId ? `, committeeId: "${committeeId}"` : ''}${supportOrOppose ? `, supportOrOppose: "${supportOrOppose}"` : ''}${sourceSystem ? `, sourceSystem: "${sourceSystem}"` : ''}) {
      items {
        id
        externalId
        committeeId
        committeeName
        candidateName
        propositionTitle
        supportOrOppose
        amount
        date
        sourceSystem
      }
      total
      hasMore
    }
  }
`;

const buildIndependentExpenditureByIdQuery = (id: string) => `
  query {
    independentExpenditure(id: "${id}") {
      id
      externalId
      committeeId
      committeeName
      supportOrOppose
      amount
      date
      sourceSystem
    }
  }
`;

describe('Region Integration Tests', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('Database Operations: Representatives', () => {
    it('should create a representative in the database', async () => {
      const rep = await createRepresentative({
        name: 'Jane Smith',
        chamber: 'Senate',
        district: 'CA-1',
        party: 'Independent',
      });

      expect(rep).toBeDefined();
      expect(rep.id).toBeDefined();
      expect(rep.name).toBe('Jane Smith');
      expect(rep.chamber).toBe('Senate');
      expect(rep.district).toBe('CA-1');
      expect(rep.party).toBe('Independent');
    });

    it('should find a representative by ID', async () => {
      const created = await createRepresentative({
        name: 'John Doe',
        chamber: 'House',
      });

      const db = await getDbService();
      const found = await db.representative.findUnique({
        where: { id: created.id },
      });

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('John Doe');
    });

    it('should list representatives filtered by chamber', async () => {
      await createRepresentative({ name: 'House Rep 1', chamber: 'House' });
      await createRepresentative({ name: 'House Rep 2', chamber: 'House' });
      await createRepresentative({ name: 'Senate Rep 1', chamber: 'Senate' });

      const db = await getDbService();
      const houseReps = await db.representative.findMany({
        where: { chamber: 'House' },
      });

      expect(houseReps).toHaveLength(2);
      houseReps.forEach((rep) => expect(rep.chamber).toBe('House'));
    });

    it('should store contact info as JSON', async () => {
      const rep = await createRepresentative({
        name: 'Contact Test',
        contactInfo: {
          email: 'rep@example.gov',
          phone: '555-1234',
          website: 'https://rep.gov',
        },
      });

      const db = await getDbService();
      const found = await db.representative.findUnique({
        where: { id: rep.id },
      });

      expect(found?.contactInfo).toBeDefined();
      const contactInfo = found?.contactInfo as {
        email?: string;
        phone?: string;
        website?: string;
      };
      expect(contactInfo.email).toBe('rep@example.gov');
      expect(contactInfo.phone).toBe('555-1234');
    });
  });

  describe('Database Operations: Propositions', () => {
    it('should create a proposition in the database', async () => {
      const prop = await createProposition({
        title: 'Prop 1: Test Initiative',
        summary: 'A test ballot initiative',
        status: 'pending',
      });

      expect(prop).toBeDefined();
      expect(prop.id).toBeDefined();
      expect(prop.title).toBe('Prop 1: Test Initiative');
      expect(prop.summary).toBe('A test ballot initiative');
      expect(prop.status).toBe('pending');
    });

    it('should find a proposition by ID', async () => {
      const created = await createProposition({
        title: 'Findable Prop',
      });

      const db = await getDbService();
      const found = await db.proposition.findUnique({
        where: { id: created.id },
      });

      expect(found).toBeDefined();
      expect(found?.title).toBe('Findable Prop');
    });

    it('should update proposition status', async () => {
      const prop = await createProposition({
        title: 'Status Change Prop',
        status: 'pending',
      });

      const db = await getDbService();
      const updated = await db.proposition.update({
        where: { id: prop.id },
        data: { status: 'passed' },
      });

      expect(updated.status).toBe('passed');
    });
  });

  describe('Database Operations: Meetings', () => {
    it('should create a meeting in the database', async () => {
      const scheduledDate = new Date('2025-06-15T14:00:00Z');
      const meeting = await createMeeting({
        title: 'City Council Meeting',
        body: 'City Council',
        scheduledAt: scheduledDate,
        location: 'City Hall Room 201',
      });

      expect(meeting).toBeDefined();
      expect(meeting.id).toBeDefined();
      expect(meeting.title).toBe('City Council Meeting');
      expect(meeting.body).toBe('City Council');
      expect(meeting.location).toBe('City Hall Room 201');
    });

    it('should find a meeting by ID', async () => {
      const created = await createMeeting({
        title: 'Findable Meeting',
      });

      const db = await getDbService();
      const found = await db.meeting.findUnique({
        where: { id: created.id },
      });

      expect(found).toBeDefined();
      expect(found?.title).toBe('Findable Meeting');
    });

    it('should list meetings ordered by scheduled date', async () => {
      const now = new Date();
      await createMeeting({
        title: 'Future Meeting',
        scheduledAt: new Date(now.getTime() + 86400000), // Tomorrow
      });
      await createMeeting({
        title: 'Past Meeting',
        scheduledAt: new Date(now.getTime() - 86400000), // Yesterday
      });

      const db = await getDbService();
      const meetings = await db.meeting.findMany({
        orderBy: { scheduledAt: 'desc' },
      });

      expect(meetings).toHaveLength(2);
      expect(meetings[0].title).toBe('Future Meeting');
      expect(meetings[1].title).toBe('Past Meeting');
    });
  });

  describe('GraphQL: regionInfo Query', () => {
    it('should return region info', async () => {
      const result = await graphqlRequest<{
        regionInfo: {
          id: string;
          name: string;
          description: string;
          timezone: string;
          supportedDataTypes: string[];
        };
      }>(REGION_INFO_QUERY);

      assertNoErrors(result);
      expect(result.data.regionInfo).toBeDefined();
      expect(result.data.regionInfo.name).toBeDefined();
      expect(result.data.regionInfo.timezone).toBeDefined();
      expect(Array.isArray(result.data.regionInfo.supportedDataTypes)).toBe(
        true,
      );
    });
  });

  describe('GraphQL: representatives Query', () => {
    it('should return paginated representatives', async () => {
      await createRepresentative({ name: 'Rep A', chamber: 'House' });
      await createRepresentative({ name: 'Rep B', chamber: 'Senate' });
      await createRepresentative({ name: 'Rep C', chamber: 'House' });

      const result = await graphqlRequest<{
        representatives: {
          items: Array<{ id: string; name: string; chamber: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildRepresentativesQuery(0, 10));

      assertNoErrors(result);
      expect(result.data.representatives.items).toHaveLength(3);
      expect(result.data.representatives.total).toBe(3);
      expect(result.data.representatives.hasMore).toBe(false);
    });

    it('should filter representatives by chamber', async () => {
      await createRepresentative({ name: 'House Rep', chamber: 'House' });
      await createRepresentative({ name: 'Senate Rep', chamber: 'Senate' });

      const result = await graphqlRequest<{
        representatives: {
          items: Array<{ id: string; name: string; chamber: string }>;
          total: number;
        };
      }>(buildRepresentativesQuery(0, 10, 'Senate'));

      assertNoErrors(result);
      expect(result.data.representatives.items).toHaveLength(1);
      expect(result.data.representatives.items[0].chamber).toBe('Senate');
      expect(result.data.representatives.total).toBe(1);
    });

    it('should paginate representatives correctly', async () => {
      // Create 5 representatives
      for (let i = 1; i <= 5; i++) {
        await createRepresentative({ name: `Rep ${i}`, chamber: 'House' });
      }

      const result = await graphqlRequest<{
        representatives: {
          items: Array<{ name: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildRepresentativesQuery(0, 2));

      assertNoErrors(result);
      expect(result.data.representatives.items).toHaveLength(2);
      expect(result.data.representatives.total).toBe(5);
      expect(result.data.representatives.hasMore).toBe(true);
    });
  });

  describe('GraphQL: representative Query', () => {
    it('should find representative by ID', async () => {
      const rep = await createRepresentative({
        name: 'Specific Rep',
        chamber: 'House',
        district: 'CA-42',
      });

      const result = await graphqlRequest<{
        representative: {
          id: string;
          name: string;
          chamber: string;
          district: string;
        };
      }>(buildRepresentativeByIdQuery(rep.id));

      assertNoErrors(result);
      expect(result.data.representative).toBeDefined();
      expect(result.data.representative.name).toBe('Specific Rep');
      expect(result.data.representative.district).toBe('CA-42');
    });

    it('should return null for non-existent representative', async () => {
      const result = await graphqlRequest<{
        representative: null;
      }>(buildRepresentativeByIdQuery('non-existent-id'));

      assertNoErrors(result);
      expect(result.data.representative).toBeNull();
    });
  });

  describe('GraphQL: propositions Query', () => {
    it('should return paginated propositions', async () => {
      await createProposition({ title: 'Prop A' });
      await createProposition({ title: 'Prop B' });

      const result = await graphqlRequest<{
        propositions: {
          items: Array<{ id: string; title: string; status: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildPropositionsQuery(0, 10));

      assertNoErrors(result);
      expect(result.data.propositions.items).toHaveLength(2);
      expect(result.data.propositions.total).toBe(2);
    });

    it('should paginate propositions correctly', async () => {
      for (let i = 1; i <= 5; i++) {
        await createProposition({ title: `Prop ${i}` });
      }

      const result = await graphqlRequest<{
        propositions: {
          items: Array<{ title: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildPropositionsQuery(0, 3));

      assertNoErrors(result);
      expect(result.data.propositions.items).toHaveLength(3);
      expect(result.data.propositions.total).toBe(5);
      expect(result.data.propositions.hasMore).toBe(true);
    });
  });

  describe('GraphQL: proposition Query', () => {
    it('should find proposition by ID', async () => {
      const prop = await createProposition({
        title: 'Specific Proposition',
        summary: 'A very specific prop',
        status: 'pending',
      });

      const result = await graphqlRequest<{
        proposition: {
          id: string;
          title: string;
          summary: string;
          status: string;
        };
      }>(buildPropositionByIdQuery(prop.id));

      assertNoErrors(result);
      expect(result.data.proposition).toBeDefined();
      expect(result.data.proposition.title).toBe('Specific Proposition');
      expect(result.data.proposition.summary).toBe('A very specific prop');
    });

    it('should return null for non-existent proposition', async () => {
      const result = await graphqlRequest<{
        proposition: null;
      }>(buildPropositionByIdQuery('non-existent-id'));

      assertNoErrors(result);
      expect(result.data.proposition).toBeNull();
    });
  });

  describe('GraphQL: meetings Query', () => {
    it('should return paginated meetings', async () => {
      await createMeeting({ title: 'Meeting A' });
      await createMeeting({ title: 'Meeting B' });

      const result = await graphqlRequest<{
        meetings: {
          items: Array<{ id: string; title: string; body: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildMeetingsQuery(0, 10));

      assertNoErrors(result);
      expect(result.data.meetings.items).toHaveLength(2);
      expect(result.data.meetings.total).toBe(2);
    });

    it('should paginate meetings correctly', async () => {
      for (let i = 1; i <= 4; i++) {
        await createMeeting({ title: `Meeting ${i}` });
      }

      const result = await graphqlRequest<{
        meetings: {
          items: Array<{ title: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildMeetingsQuery(0, 2));

      assertNoErrors(result);
      expect(result.data.meetings.items).toHaveLength(2);
      expect(result.data.meetings.total).toBe(4);
      expect(result.data.meetings.hasMore).toBe(true);
    });
  });

  describe('GraphQL: meeting Query', () => {
    it('should find meeting by ID', async () => {
      const meeting = await createMeeting({
        title: 'Specific Meeting',
        body: 'Planning Commission',
        location: 'Room 100',
      });

      const result = await graphqlRequest<{
        meeting: {
          id: string;
          title: string;
          body: string;
          location: string;
        };
      }>(buildMeetingByIdQuery(meeting.id));

      assertNoErrors(result);
      expect(result.data.meeting).toBeDefined();
      expect(result.data.meeting.title).toBe('Specific Meeting');
      expect(result.data.meeting.body).toBe('Planning Commission');
      expect(result.data.meeting.location).toBe('Room 100');
    });

    it('should return null for non-existent meeting', async () => {
      const result = await graphqlRequest<{
        meeting: null;
      }>(buildMeetingByIdQuery('non-existent-id'));

      assertNoErrors(result);
      expect(result.data.meeting).toBeNull();
    });
  });

  // ==========================================
  // CAMPAIGN FINANCE: DATABASE OPERATIONS
  // ==========================================

  describe('Database Operations: Committees', () => {
    it('should create a committee in the database', async () => {
      const committee = await createCommittee({
        name: 'Citizens for Progress',
        type: 'pac',
        status: 'active',
        sourceSystem: 'cal_access',
      });

      expect(committee).toBeDefined();
      expect(committee.id).toBeDefined();
      expect(committee.name).toBe('Citizens for Progress');
      expect(committee.type).toBe('pac');
      expect(committee.status).toBe('active');
      expect(committee.sourceSystem).toBe('cal_access');
    });

    it('should find a committee by ID', async () => {
      const created = await createCommittee({
        name: 'Findable Committee',
      });

      const db = await getDbService();
      const found = await db.committee.findUnique({
        where: { id: created.id },
      });

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Findable Committee');
    });

    it('should list committees filtered by sourceSystem', async () => {
      await createCommittee({
        name: 'Cal Committee',
        sourceSystem: 'cal_access',
      });
      await createCommittee({ name: 'FEC Committee', sourceSystem: 'fec' });
      await createCommittee({
        name: 'Another Cal Committee',
        sourceSystem: 'cal_access',
      });

      const db = await getDbService();
      const calCommittees = await db.committee.findMany({
        where: { sourceSystem: 'cal_access' },
      });

      expect(calCommittees).toHaveLength(2);
      calCommittees.forEach((c) => expect(c.sourceSystem).toBe('cal_access'));
    });
  });

  describe('Database Operations: Contributions', () => {
    it('should create a contribution with committee reference', async () => {
      const committee = await createCommittee({ name: 'Test PAC' });
      const contribution = await createContribution({
        committeeId: committee.id,
        donorName: 'Jane Donor',
        donorType: 'individual',
        amount: 250,
      });

      expect(contribution).toBeDefined();
      expect(contribution.id).toBeDefined();
      expect(contribution.committeeId).toBe(committee.id);
      expect(contribution.donorName).toBe('Jane Donor');
      expect(Number(contribution.amount)).toBe(250);
    });

    it('should find a contribution by ID', async () => {
      const committee = await createCommittee();
      const created = await createContribution({
        committeeId: committee.id,
        donorName: 'Findable Donor',
      });

      const db = await getDbService();
      const found = await db.contribution.findUnique({
        where: { id: created.id },
      });

      expect(found).toBeDefined();
      expect(found?.donorName).toBe('Findable Donor');
    });

    it('should list contributions filtered by committeeId', async () => {
      const committee1 = await createCommittee({ name: 'Committee A' });
      const committee2 = await createCommittee({ name: 'Committee B' });
      await createContribution({
        committeeId: committee1.id,
        donorName: 'Donor 1',
      });
      await createContribution({
        committeeId: committee1.id,
        donorName: 'Donor 2',
      });
      await createContribution({
        committeeId: committee2.id,
        donorName: 'Donor 3',
      });

      const db = await getDbService();
      const contributions = await db.contribution.findMany({
        where: { committeeId: committee1.id },
      });

      expect(contributions).toHaveLength(2);
      contributions.forEach((c) => expect(c.committeeId).toBe(committee1.id));
    });
  });

  describe('Database Operations: Expenditures', () => {
    it('should create an expenditure with committee reference', async () => {
      const committee = await createCommittee();
      const expenditure = await createExpenditure({
        committeeId: committee.id,
        payeeName: 'Ad Agency Inc',
        amount: 15000,
      });

      expect(expenditure).toBeDefined();
      expect(expenditure.committeeId).toBe(committee.id);
      expect(expenditure.payeeName).toBe('Ad Agency Inc');
      expect(Number(expenditure.amount)).toBe(15000);
    });

    it('should find an expenditure by ID', async () => {
      const committee = await createCommittee();
      const created = await createExpenditure({
        committeeId: committee.id,
        payeeName: 'Findable Payee',
      });

      const db = await getDbService();
      const found = await db.expenditure.findUnique({
        where: { id: created.id },
      });

      expect(found).toBeDefined();
      expect(found?.payeeName).toBe('Findable Payee');
    });

    it('should store Decimal amount correctly', async () => {
      const committee = await createCommittee();
      const created = await createExpenditure({
        committeeId: committee.id,
        amount: 12345.67,
      });

      const db = await getDbService();
      const found = await db.expenditure.findUnique({
        where: { id: created.id },
      });

      expect(Number(found?.amount)).toBeCloseTo(12345.67, 2);
    });
  });

  describe('Database Operations: Independent Expenditures', () => {
    it('should create an independent expenditure', async () => {
      const committee = await createCommittee();
      const ie = await createIndependentExpenditure({
        committeeId: committee.id,
        committeeName: 'Super PAC for Justice',
        supportOrOppose: 'support',
        amount: 50000,
      });

      expect(ie).toBeDefined();
      expect(ie.committeeName).toBe('Super PAC for Justice');
      expect(ie.supportOrOppose).toBe('support');
      expect(Number(ie.amount)).toBe(50000);
    });

    it('should find an independent expenditure by ID', async () => {
      const committee = await createCommittee();
      const created = await createIndependentExpenditure({
        committeeId: committee.id,
        committeeName: 'Findable IE',
      });

      const db = await getDbService();
      const found = await db.independentExpenditure.findUnique({
        where: { id: created.id },
      });

      expect(found).toBeDefined();
      expect(found?.committeeName).toBe('Findable IE');
    });

    it('should list independent expenditures filtered by supportOrOppose', async () => {
      const committee = await createCommittee();
      await createIndependentExpenditure({
        committeeId: committee.id,
        supportOrOppose: 'support',
      });
      await createIndependentExpenditure({
        committeeId: committee.id,
        supportOrOppose: 'oppose',
      });
      await createIndependentExpenditure({
        committeeId: committee.id,
        supportOrOppose: 'support',
      });

      const db = await getDbService();
      const supportIEs = await db.independentExpenditure.findMany({
        where: { supportOrOppose: 'support' },
      });

      expect(supportIEs).toHaveLength(2);
      supportIEs.forEach((ie) => expect(ie.supportOrOppose).toBe('support'));
    });
  });

  // ==========================================
  // CAMPAIGN FINANCE: GRAPHQL QUERIES
  // ==========================================

  describe('GraphQL: committees Query', () => {
    it('should return paginated committees', async () => {
      await createCommittee({ name: 'Committee A' });
      await createCommittee({ name: 'Committee B' });

      const result = await graphqlRequest<{
        committees: {
          items: Array<{ id: string; name: string; sourceSystem: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildCommitteesQuery(0, 10));

      assertNoErrors(result);
      expect(result.data.committees.items).toHaveLength(2);
      expect(result.data.committees.total).toBe(2);
      expect(result.data.committees.hasMore).toBe(false);
    });

    it('should filter committees by sourceSystem', async () => {
      await createCommittee({
        name: 'Cal Committee',
        sourceSystem: 'cal_access',
      });
      await createCommittee({ name: 'FEC Committee', sourceSystem: 'fec' });

      const result = await graphqlRequest<{
        committees: {
          items: Array<{ name: string; sourceSystem: string }>;
          total: number;
        };
      }>(buildCommitteesQuery(0, 10, 'fec'));

      assertNoErrors(result);
      expect(result.data.committees.items).toHaveLength(1);
      expect(result.data.committees.items[0].sourceSystem).toBe('fec');
      expect(result.data.committees.total).toBe(1);
    });

    it('should paginate committees correctly', async () => {
      for (let i = 1; i <= 5; i++) {
        await createCommittee({ name: `Committee ${i}` });
      }

      const result = await graphqlRequest<{
        committees: {
          items: Array<{ name: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildCommitteesQuery(0, 2));

      assertNoErrors(result);
      expect(result.data.committees.items).toHaveLength(2);
      expect(result.data.committees.total).toBe(5);
      expect(result.data.committees.hasMore).toBe(true);
    });
  });

  describe('GraphQL: committee Query', () => {
    it('should find committee by ID', async () => {
      const committee = await createCommittee({
        name: 'Specific Committee',
        type: 'candidate',
        status: 'active',
      });

      const result = await graphqlRequest<{
        committee: {
          id: string;
          name: string;
          type: string;
          status: string;
          sourceSystem: string;
        };
      }>(buildCommitteeByIdQuery(committee.id));

      assertNoErrors(result);
      expect(result.data.committee).toBeDefined();
      expect(result.data.committee.name).toBe('Specific Committee');
      expect(result.data.committee.type).toBe('candidate');
    });

    it('should return null for non-existent committee', async () => {
      const result = await graphqlRequest<{
        committee: null;
      }>(buildCommitteeByIdQuery('non-existent-id'));

      assertNoErrors(result);
      expect(result.data.committee).toBeNull();
    });
  });

  describe('GraphQL: contributions Query', () => {
    it('should return paginated contributions with Float amounts', async () => {
      const committee = await createCommittee();
      await createContribution({ committeeId: committee.id, amount: 250.5 });
      await createContribution({ committeeId: committee.id, amount: 1000 });

      const result = await graphqlRequest<{
        contributions: {
          items: Array<{ id: string; donorName: string; amount: number }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildContributionsQuery(0, 10));

      assertNoErrors(result);
      expect(result.data.contributions.items).toHaveLength(2);
      expect(result.data.contributions.total).toBe(2);
      // Verify amounts are numbers (Float), not strings
      result.data.contributions.items.forEach((item) => {
        expect(typeof item.amount).toBe('number');
      });
    });

    it('should filter contributions by committeeId', async () => {
      const committee1 = await createCommittee({ name: 'Committee 1' });
      const committee2 = await createCommittee({ name: 'Committee 2' });
      await createContribution({ committeeId: committee1.id });
      await createContribution({ committeeId: committee1.id });
      await createContribution({ committeeId: committee2.id });

      const result = await graphqlRequest<{
        contributions: {
          items: Array<{ committeeId: string }>;
          total: number;
        };
      }>(buildContributionsQuery(0, 10, committee1.id));

      assertNoErrors(result);
      expect(result.data.contributions.items).toHaveLength(2);
      expect(result.data.contributions.total).toBe(2);
    });

    it('should filter contributions by sourceSystem', async () => {
      const calCommittee = await createCommittee({
        sourceSystem: 'cal_access',
      });
      const fecCommittee = await createCommittee({ sourceSystem: 'fec' });
      await createContribution({
        committeeId: calCommittee.id,
        sourceSystem: 'cal_access',
      });
      await createContribution({
        committeeId: fecCommittee.id,
        sourceSystem: 'fec',
      });

      const result = await graphqlRequest<{
        contributions: {
          items: Array<{ sourceSystem: string }>;
          total: number;
        };
      }>(buildContributionsQuery(0, 10, undefined, 'fec'));

      assertNoErrors(result);
      expect(result.data.contributions.items).toHaveLength(1);
      expect(result.data.contributions.items[0].sourceSystem).toBe('fec');
    });
  });

  describe('GraphQL: contribution Query', () => {
    it('should find contribution by ID', async () => {
      const committee = await createCommittee();
      const contribution = await createContribution({
        committeeId: committee.id,
        donorName: 'Specific Donor',
        amount: 750,
      });

      const result = await graphqlRequest<{
        contribution: {
          id: string;
          donorName: string;
          amount: number;
        };
      }>(buildContributionByIdQuery(contribution.id));

      assertNoErrors(result);
      expect(result.data.contribution).toBeDefined();
      expect(result.data.contribution.donorName).toBe('Specific Donor');
      expect(result.data.contribution.amount).toBe(750);
    });

    it('should return null for non-existent contribution', async () => {
      const result = await graphqlRequest<{
        contribution: null;
      }>(buildContributionByIdQuery('non-existent-id'));

      assertNoErrors(result);
      expect(result.data.contribution).toBeNull();
    });
  });

  describe('GraphQL: expenditures Query', () => {
    it('should return paginated expenditures', async () => {
      const committee = await createCommittee();
      await createExpenditure({
        committeeId: committee.id,
        payeeName: 'Payee A',
      });
      await createExpenditure({
        committeeId: committee.id,
        payeeName: 'Payee B',
      });

      const result = await graphqlRequest<{
        expenditures: {
          items: Array<{ id: string; payeeName: string; amount: number }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildExpendituresQuery(0, 10));

      assertNoErrors(result);
      expect(result.data.expenditures.items).toHaveLength(2);
      expect(result.data.expenditures.total).toBe(2);
    });

    it('should filter expenditures by committeeId', async () => {
      const committee1 = await createCommittee({ name: 'Exp Committee 1' });
      const committee2 = await createCommittee({ name: 'Exp Committee 2' });
      await createExpenditure({ committeeId: committee1.id });
      await createExpenditure({ committeeId: committee2.id });
      await createExpenditure({ committeeId: committee2.id });

      const result = await graphqlRequest<{
        expenditures: {
          items: Array<{ committeeId: string }>;
          total: number;
        };
      }>(buildExpendituresQuery(0, 10, committee2.id));

      assertNoErrors(result);
      expect(result.data.expenditures.items).toHaveLength(2);
      expect(result.data.expenditures.total).toBe(2);
    });

    it('should paginate expenditures correctly', async () => {
      const committee = await createCommittee();
      for (let i = 1; i <= 5; i++) {
        await createExpenditure({
          committeeId: committee.id,
          payeeName: `Payee ${i}`,
        });
      }

      const result = await graphqlRequest<{
        expenditures: {
          items: Array<{ payeeName: string }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildExpendituresQuery(0, 3));

      assertNoErrors(result);
      expect(result.data.expenditures.items).toHaveLength(3);
      expect(result.data.expenditures.total).toBe(5);
      expect(result.data.expenditures.hasMore).toBe(true);
    });
  });

  describe('GraphQL: expenditure Query', () => {
    it('should find expenditure by ID', async () => {
      const committee = await createCommittee();
      const expenditure = await createExpenditure({
        committeeId: committee.id,
        payeeName: 'Specific Payee',
        amount: 3000,
      });

      const result = await graphqlRequest<{
        expenditure: {
          id: string;
          payeeName: string;
          amount: number;
        };
      }>(buildExpenditureByIdQuery(expenditure.id));

      assertNoErrors(result);
      expect(result.data.expenditure).toBeDefined();
      expect(result.data.expenditure.payeeName).toBe('Specific Payee');
      expect(result.data.expenditure.amount).toBe(3000);
    });

    it('should return null for non-existent expenditure', async () => {
      const result = await graphqlRequest<{
        expenditure: null;
      }>(buildExpenditureByIdQuery('non-existent-id'));

      assertNoErrors(result);
      expect(result.data.expenditure).toBeNull();
    });
  });

  describe('GraphQL: independentExpenditures Query', () => {
    it('should return paginated independent expenditures', async () => {
      const committee = await createCommittee();
      await createIndependentExpenditure({
        committeeId: committee.id,
        supportOrOppose: 'support',
      });
      await createIndependentExpenditure({
        committeeId: committee.id,
        supportOrOppose: 'oppose',
      });

      const result = await graphqlRequest<{
        independentExpenditures: {
          items: Array<{ id: string; supportOrOppose: string; amount: number }>;
          total: number;
          hasMore: boolean;
        };
      }>(buildIndependentExpendituresQuery(0, 10));

      assertNoErrors(result);
      expect(result.data.independentExpenditures.items).toHaveLength(2);
      expect(result.data.independentExpenditures.total).toBe(2);
    });

    it('should filter independent expenditures by supportOrOppose', async () => {
      const committee = await createCommittee();
      await createIndependentExpenditure({
        committeeId: committee.id,
        supportOrOppose: 'support',
      });
      await createIndependentExpenditure({
        committeeId: committee.id,
        supportOrOppose: 'oppose',
      });
      await createIndependentExpenditure({
        committeeId: committee.id,
        supportOrOppose: 'support',
      });

      const result = await graphqlRequest<{
        independentExpenditures: {
          items: Array<{ supportOrOppose: string }>;
          total: number;
        };
      }>(buildIndependentExpendituresQuery(0, 10, undefined, 'oppose'));

      assertNoErrors(result);
      expect(result.data.independentExpenditures.items).toHaveLength(1);
      expect(result.data.independentExpenditures.items[0].supportOrOppose).toBe(
        'oppose',
      );
    });

    it('should filter independent expenditures by committeeId', async () => {
      const committee1 = await createCommittee({ name: 'IE Committee 1' });
      const committee2 = await createCommittee({ name: 'IE Committee 2' });
      await createIndependentExpenditure({ committeeId: committee1.id });
      await createIndependentExpenditure({ committeeId: committee2.id });
      await createIndependentExpenditure({ committeeId: committee2.id });

      const result = await graphqlRequest<{
        independentExpenditures: {
          items: Array<{ committeeId: string }>;
          total: number;
        };
      }>(buildIndependentExpendituresQuery(0, 10, committee2.id));

      assertNoErrors(result);
      expect(result.data.independentExpenditures.items).toHaveLength(2);
      expect(result.data.independentExpenditures.total).toBe(2);
    });
  });

  describe('GraphQL: independentExpenditure Query', () => {
    it('should find independent expenditure by ID', async () => {
      const committee = await createCommittee();
      const ie = await createIndependentExpenditure({
        committeeId: committee.id,
        committeeName: 'Specific IE PAC',
        supportOrOppose: 'oppose',
        amount: 25000,
      });

      const result = await graphqlRequest<{
        independentExpenditure: {
          id: string;
          committeeName: string;
          supportOrOppose: string;
          amount: number;
        };
      }>(buildIndependentExpenditureByIdQuery(ie.id));

      assertNoErrors(result);
      expect(result.data.independentExpenditure).toBeDefined();
      expect(result.data.independentExpenditure.committeeName).toBe(
        'Specific IE PAC',
      );
      expect(result.data.independentExpenditure.supportOrOppose).toBe('oppose');
      expect(result.data.independentExpenditure.amount).toBe(25000);
    });

    it('should return null for non-existent independent expenditure', async () => {
      const result = await graphqlRequest<{
        independentExpenditure: null;
      }>(buildIndependentExpenditureByIdQuery('non-existent-id'));

      assertNoErrors(result);
      expect(result.data.independentExpenditure).toBeNull();
    });
  });

  // ==========================================
  // DATABASE CLEANUP
  // ==========================================

  describe('Database cleanup', () => {
    it('should have clean database at start of each test', async () => {
      await createRepresentative({ name: 'Cleanup Test Rep' });
      await createProposition({ title: 'Cleanup Test Prop' });
      await createMeeting({ title: 'Cleanup Test Meeting' });

      const db = await getDbService();
      const reps = await db.representative.findMany();
      const props = await db.proposition.findMany();
      const meetings = await db.meeting.findMany();

      expect(reps).toHaveLength(1);
      expect(props).toHaveLength(1);
      expect(meetings).toHaveLength(1);
    });

    it('should not see data from previous tests', async () => {
      const db = await getDbService();
      const reps = await db.representative.findMany();
      const props = await db.proposition.findMany();
      const meetings = await db.meeting.findMany();

      expect(reps).toHaveLength(0);
      expect(props).toHaveLength(0);
      expect(meetings).toHaveLength(0);
    });

    it('should clean campaign finance tables between tests', async () => {
      const committee = await createCommittee({ name: 'Cleanup Committee' });
      await createContribution({ committeeId: committee.id });
      await createExpenditure({ committeeId: committee.id });
      await createIndependentExpenditure({ committeeId: committee.id });

      const db = await getDbService();
      expect(await db.committee.findMany()).toHaveLength(1);
      expect(await db.contribution.findMany()).toHaveLength(1);
      expect(await db.expenditure.findMany()).toHaveLength(1);
      expect(await db.independentExpenditure.findMany()).toHaveLength(1);
    });

    it('should not see campaign finance data from previous tests', async () => {
      const db = await getDbService();
      expect(await db.committee.findMany()).toHaveLength(0);
      expect(await db.contribution.findMany()).toHaveLength(0);
      expect(await db.expenditure.findMany()).toHaveLength(0);
      expect(await db.independentExpenditure.findMany()).toHaveLength(0);
    });
  });
});
