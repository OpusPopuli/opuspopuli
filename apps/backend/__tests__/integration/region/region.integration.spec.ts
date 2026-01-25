/**
 * Region Integration Tests
 *
 * Tests region/civic data operations against real database and GraphQL endpoints.
 * Covers Representatives, Propositions, and Meetings.
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createRepresentative,
  createProposition,
  createMeeting,
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
  });
});
