import {
  DomainMapperService,
  cleanPropositionTitle,
} from "../src/mapping/domain-mapper.service";
import {
  DataType,
  type RawExtractionResult,
  type DataSourceConfig,
} from "@opuspopuli/common";

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: "https://example.com",
    dataType: DataType.PROPOSITIONS,
    contentGoal: "Extract data",
    ...overrides,
  };
}

function createRawResult(
  overrides: Partial<RawExtractionResult> = {},
): RawExtractionResult {
  return {
    items: [],
    success: true,
    warnings: [],
    errors: [],
    ...overrides,
  };
}

describe("cleanPropositionTitle", () => {
  it("strips measure-id + author + chapter-info + (PDF) from real SOS anchor text", () => {
    expect(
      cleanPropositionTitle(
        "ACA 13 (Ward) Voting thresholds. (Res. Ch. 176, 2023) (PDF)",
      ),
    ).toBe("Voting thresholds");
    expect(
      cleanPropositionTitle(
        "SB 42 (Umberg) Political Reform Act of 1974: public campaign financing: California Fair Elections Act of 2026. (Ch. 245, 2025) (PDF)",
      ),
    ).toBe(
      "Political Reform Act of 1974: public campaign financing: California Fair Elections Act of 2026",
    );
    expect(
      cleanPropositionTitle(
        "SCA 1 (Newman) Elections: recall of state officers. (Res. Ch. 204, 2024) (PDF)",
      ),
    ).toBe("Elections: recall of state officers");
  });

  it("handles multi-letter and single-digit measure prefixes", () => {
    expect(cleanPropositionTitle("AB 1 (Doe) Short title. (PDF)")).toBe(
      "Short title",
    );
    expect(
      cleanPropositionTitle(
        "SCA 21 (Smith) Long title here. (Res. Ch. 99, 2025) (PDF)",
      ),
    ).toBe("Long title here");
  });

  it("strips only one trailing parenthetical group cleanly when there is one", () => {
    expect(cleanPropositionTitle("AB 5 (Doe) Title. (PDF)")).toBe("Title");
  });

  it("handles colons and punctuation inside the title", () => {
    expect(
      cleanPropositionTitle(
        "AB 1 (Doe) Education: K-12 funding: cost-of-living adjustments. (PDF)",
      ),
    ).toBe("Education: K-12 funding: cost-of-living adjustments");
  });

  it("trims whitespace", () => {
    expect(cleanPropositionTitle("  ACA 13 (Ward)  Title.   (PDF)  ")).toBe(
      "Title",
    );
  });

  it("returns empty for empty input, trimmed input for whitespace-only", () => {
    expect(cleanPropositionTitle("")).toBe("");
    expect(cleanPropositionTitle("   ")).toBe("");
  });

  it("falls back to the trimmed input when stripping empties the string", () => {
    // Pathological: anchor with measure id + author parenthetical but no
    // descriptive title body. We must not return "" — the schema's
    // min(1) validator would reject the row.
    expect(cleanPropositionTitle("AB 1 (Doe) (PDF)")).toBe("AB 1 (Doe) (PDF)");
  });

  it("leaves an already-clean title unchanged", () => {
    expect(cleanPropositionTitle("Voting thresholds")).toBe(
      "Voting thresholds",
    );
  });
});

describe("DomainMapperService", () => {
  let mapper: DomainMapperService;

  beforeEach(() => {
    mapper = new DomainMapperService();
  });

  describe("propositions", () => {
    it("should map valid proposition records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "PROP-36",
              title: "Criminal Law Reform",
              summary: "A measure to reform criminal sentencing",
            },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        externalId: "PROP-36",
        title: "Criminal Law Reform",
      });
    });

    it("should reject propositions missing required fields", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ summary: "No ID or title" }],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.success).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it("cleans the title from raw SOS anchor text and routes detailUrl → sourceUrl", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "ACA 13",
              title:
                "ACA 13 (Ward) Voting thresholds. (Res. Ch. 176, 2023) (PDF)",
              detailUrl:
                "https://www.sos.ca.gov/elections/ballot-measures/pdf/aca-13.pdf",
            },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        externalId: "ACA 13",
        title: "Voting thresholds",
        // summary defaults to cleaned title until AI analysis populates analysis_summary
        summary: "Voting thresholds",
        sourceUrl:
          "https://www.sos.ca.gov/elections/ballot-measures/pdf/aca-13.pdf",
      });
    });

    it("prefers an explicit sourceUrl over detailUrl when both present", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "PROP-X",
              title: "X",
              sourceUrl: "https://example.com/explicit",
              detailUrl: "https://example.com/harvest",
            },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );
      expect(result.items[0]).toMatchObject({
        sourceUrl: "https://example.com/explicit",
      });
    });

    it("should use title as summary when summary is empty", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "SB-42",
              title: "Education Budget",
              summary: "",
            },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.items[0]).toMatchObject({
        summary: "Education Budget",
      });
    });

    it("should coerce electionDate strings to Date", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "ACA-13",
              title: "Voting Thresholds",
              electionDate: "2026-11-03",
            },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.items[0]).toHaveProperty("electionDate");
    });
  });

  describe("meetings", () => {
    it("should map valid meeting records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "MTG-001",
              title: "Budget Committee Hearing",
              scheduledAt: "2026-03-15T10:00:00Z",
              location: "Room 4202",
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        externalId: "MTG-001",
        title: "Budget Committee Hearing",
        location: "Room 4202",
      });
    });

    it("should inject category as body when not in record", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "MTG-002",
              title: "Floor Session",
              scheduledAt: "2026-03-15T10:00:00Z",
            },
          ],
        }),
        createSource({
          dataType: DataType.MEETINGS,
          category: "Assembly",
        }),
      );

      expect(result.items[0]).toMatchObject({ body: "Assembly" });
    });

    it("recomposes externalId when LLM emits a bare date (CA Assembly daily-file case)", () => {
      // The LLM extracts the meeting date as externalId instead of the
      // hint-specified `assembly-{committee}-{YYYY-MM-DD}` form. Two
      // committees on the same date would otherwise collide on upsert
      // and silently dedup. Mapper composes a unique form from
      // body + title + date.
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "05/04/26",
              title: "Rules",
              body: "Assembly",
              scheduledAt: "2026-05-04T10:00:00Z",
            },
            {
              externalId: "05/04/26",
              title: "Utilities And Energy",
              body: "Assembly",
              scheduledAt: "2026-05-04T13:00:00Z",
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        externalId: "assembly-rules-05/04/26",
      });
      expect(result.items[1]).toMatchObject({
        externalId: "assembly-utilities-and-energy-05/04/26",
      });
    });

    it("recognizes ISO-format dates as bare dates too", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "2026-05-04",
              title: "Rules",
              body: "Assembly",
              scheduledAt: "2026-05-04T10:00:00Z",
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );
      expect(result.items[0]).toMatchObject({
        externalId: "assembly-rules-2026-05-04",
      });
    });

    it("recomposes externalId when LLM emits a bare committee name (no date component)", () => {
      // The manifest's `name_format` transform doesn't compose across
      // fields, so the LLM's "construct externalId from committee+date"
      // call silently degrades to just the committee name. Same
      // committee meeting on different dates would otherwise collapse
      // onto one row.
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "Rules",
              title: "Rules",
              body: "Assembly",
              scheduledAt: "2026-05-04T10:00:00Z",
            },
            {
              externalId: "Rules",
              title: "Rules",
              body: "Assembly",
              scheduledAt: "2026-05-11T10:00:00Z",
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );

      expect(result.items).toHaveLength(2);
      const ids = result.items.map(
        (item) => (item as { externalId: string }).externalId,
      );
      expect(ids[0]).not.toBe("Rules");
      expect(ids[1]).not.toBe("Rules");
      expect(ids[0]).not.toBe(ids[1]);
    });

    it("coerces array-shaped agendaUrl to its first non-empty string", () => {
      // The `structured` extraction method delivers cells with multiple
      // anchors as arrays. 35 of 36 Assembly meetings on 2026-06-07
      // were rejected because zod refused the array shape. Mapper now
      // takes the first usable value (string or { href }).
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "assembly-rules-2026-05-04",
              title: "Rules",
              body: "Assembly",
              scheduledAt: "2026-05-04T10:00:00Z",
              agendaUrl: [
                "https://example.com/agenda-a.pdf",
                "https://example.com/agenda-b.pdf",
              ],
            },
            {
              externalId: "assembly-utilities-2026-05-04",
              title: "Utilities",
              body: "Assembly",
              scheduledAt: "2026-05-04T13:00:00Z",
              agendaUrl: [{ href: "https://example.com/agenda-c.pdf" }],
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        agendaUrl: "https://example.com/agenda-a.pdf",
      });
      expect(result.items[1]).toMatchObject({
        agendaUrl: "https://example.com/agenda-c.pdf",
      });
    });

    it.each([
      { key: "url", input: [{ url: "https://example.com/agenda-d.pdf" }] },
      { key: "value", input: [{ value: "https://example.com/agenda-e.pdf" }] },
    ])("coerces agendaUrl from object array with $key key", ({ input }) => {
      // Guard the `url` and `value` fallback keys in coerceFirstString —
      // sibling test above only covers `href`. A refactor that drops one
      // of these without noticing would silently lose data.
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "assembly-test-2026-05-04",
              title: "Test",
              body: "Assembly",
              scheduledAt: "2026-05-04T10:00:00Z",
              agendaUrl: input,
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );

      expect(result.items).toHaveLength(1);
      const item = result.items[0] as { agendaUrl: string };
      expect(item.agendaUrl).toMatch(/^https:\/\/example\.com\/agenda-/);
    });

    // looksLikeCompositeId is unexported — exercise it transitively through
    // composeMeetingExternalId by varying rawExternalId across the trust-gate
    // boundary. Documents the helper's intent next to the failure modes it
    // exists to prevent.
    it.each([
      // [rawExternalId, shouldBeTrustedVerbatim, description]
      ["assembly-rules-2026-05-04", true, "composite with date"],
      ["MTG-001", true, "two-segment opaque ID"],
      ["ca-assembly-30", true, "three-segment opaque ID"],
      ["Rules", false, "bare single token — the 2026-06-07 regression"],
      ["", false, "empty string"],
      ["--", false, "only separators"],
      ["05/04/26", false, "bare US date (delegated to isBareDate)"],
      ["2026-05-04", false, "bare ISO date (delegated to isBareDate)"],
    ])(
      "looksLikeCompositeId via externalId=%j → trusted=%s (%s)",
      (externalId, shouldBeTrustedVerbatim) => {
        const result = mapper.map(
          createRawResult({
            items: [
              {
                externalId,
                title: "Rules",
                body: "Assembly",
                scheduledAt: "2026-05-04T10:00:00Z",
              },
            ],
          }),
          createSource({ dataType: DataType.MEETINGS }),
        );
        expect(result.items).toHaveLength(1);
        const id = (result.items[0] as { externalId: string }).externalId;
        if (shouldBeTrustedVerbatim) {
          expect(id).toBe(externalId);
        } else {
          expect(id).not.toBe(externalId);
          expect(id.startsWith("assembly-rules-")).toBe(true);
        }
      },
    );

    it("preserves a non-bare-date externalId verbatim", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "assembly-rules-2026-05-04",
              title: "Rules",
              body: "Assembly",
              scheduledAt: "2026-05-04T10:00:00Z",
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );
      expect(result.items[0]).toMatchObject({
        externalId: "assembly-rules-2026-05-04",
      });
    });

    it("rejects a meeting with neither externalId nor title (no degenerate stub)", () => {
      // Real failure mode: senate-daily-file PDF text-extraction failed
      // entirely, the previous mapper's fallback produced `senate--` /
      // "Untitled Meeting" / 1970-01-01 stub rows. New behavior: reject.
      const result = mapper.map(
        createRawResult({
          items: [
            {
              // No externalId, no title — only category-derived body
              scheduledAt: "2026-05-04T10:00:00Z",
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS, category: "Senate" }),
      );
      expect(result.items).toHaveLength(0);
    });

    it("rejects a meeting where compose would produce a degenerate single-segment id", () => {
      // Title and body both empty, only an externalId that's a bare date
      // — recompose can't add unique segments, so the row is rejected.
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "05/04/26",
              scheduledAt: "2026-05-04T10:00:00Z",
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );
      expect(result.items).toHaveLength(0);
    });

    it("should reject meetings missing scheduledAt", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ externalId: "MTG-003", title: "No Date" }],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );

      expect(result.items).toHaveLength(0);
    });
  });

  describe("representatives", () => {
    it("should map valid representative records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "ca-assembly-30",
              name: "Jane Doe",
              district: "District 30",
              party: "Democrat",
            },
          ],
        }),
        createSource({ dataType: DataType.REPRESENTATIVES }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        externalId: "ca-assembly-30",
        name: "Jane Doe",
        district: "District 30",
        party: "Democratic",
      });
    });

    it("should normalize party abbreviations", () => {
      const testCases = [
        { input: "(D)", expected: "Democratic" },
        { input: "(R)", expected: "Republican" },
        { input: "D", expected: "Democratic" },
        { input: "R", expected: "Republican" },
        { input: "Democrat", expected: "Democratic" },
        { input: "Republican", expected: "Republican" },
        { input: "Independent", expected: "Independent" },
        { input: "I", expected: "Independent" },
        { input: "Green", expected: "Green" },
      ];

      for (const { input, expected } of testCases) {
        const result = mapper.map(
          createRawResult({
            items: [
              {
                externalId: "test-1",
                name: "Test Rep",
                district: "1",
                party: input,
              },
            ],
          }),
          createSource({ dataType: DataType.REPRESENTATIVES }),
        );
        expect(result.items[0]).toMatchObject({ party: expected });
      }
    });

    it("should inject category as chamber", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "ca-senate-1",
              name: "John Smith",
              district: "District 1",
              party: "Republican",
            },
          ],
        }),
        createSource({
          dataType: DataType.REPRESENTATIVES,
          category: "Senate",
        }),
      );

      expect(result.items[0]).toMatchObject({ chamber: "Senate" });
    });

    it("should reject representatives missing name", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ externalId: "ca-1", district: "1", party: "D" }],
        }),
        createSource({ dataType: DataType.REPRESENTATIVES }),
      );

      expect(result.items).toHaveLength(0);
    });

    it("canonicalizes externalId from relative URL path", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "/assemblymembers/22",
              name: "Juan Alanis",
              district: "District 22",
              party: "R",
            },
          ],
        }),
        createSource({
          dataType: DataType.REPRESENTATIVES,
          category: "Assembly",
        }),
      );

      expect(result.items[0]).toMatchObject({ externalId: "ca-assembly-22" });
    });

    it("canonicalizes externalId from absolute URL", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "https://www.assembly.ca.gov/assemblymembers/22",
              name: "Juan Alanis",
              district: "District 22",
              party: "R",
            },
          ],
        }),
        createSource({
          dataType: DataType.REPRESENTATIVES,
          category: "Assembly",
        }),
      );

      expect(result.items[0]).toMatchObject({ externalId: "ca-assembly-22" });
    });

    it("preserves already-canonical externalIds", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "ca-senate-4",
              name: "Brian Dahle",
              district: "District 4",
              party: "R",
            },
          ],
        }),
        createSource({
          dataType: DataType.REPRESENTATIVES,
          category: "Senate",
        }),
      );

      expect(result.items[0]).toMatchObject({ externalId: "ca-senate-4" });
    });

    it("produces the same canonical ID for drifted scrape outputs", () => {
      const variants = [
        "/assemblymembers/22",
        "https://www.assembly.ca.gov/assemblymembers/22",
        "ca-assembly-22",
      ];
      const ids = variants.map((rawId) => {
        const result = mapper.map(
          createRawResult({
            items: [
              {
                externalId: rawId,
                name: "Test",
                district: "22",
                party: "R",
              },
            ],
          }),
          createSource({
            dataType: DataType.REPRESENTATIVES,
            category: "Assembly",
          }),
        );
        return (result.items[0] as { externalId: string }).externalId;
      });

      expect(ids.every((id) => id === "ca-assembly-22")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should skip items that fail mapping and add warnings", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            { externalId: "PROP-1", title: "Valid" },
            { invalid: true },
            { externalId: "PROP-2", title: "Also Valid" },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.items).toHaveLength(2);
      expect(result.success).toBe(true);
    });

    it("should return success=false when all items fail", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ bad: true }, { also: "bad" }],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.success).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it("should preserve existing warnings and errors", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ externalId: "P1", title: "Valid" }],
          warnings: ["existing warning"],
          errors: ["existing error"],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.warnings).toContain("existing warning");
      expect(result.errors).toContain("existing error");
    });

    it("should return null for unknown data type", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ externalId: "X", name: "Test" }],
        }),
        createSource({ dataType: "unknown" as DataType }),
      );

      expect(result.items).toHaveLength(0);
    });
  });

  describe("campaign finance — committees", () => {
    it("should map valid committee records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "C001",
              name: "Citizens for Progress",
              type: "pac",
              status: "active",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "committee",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        externalId: "C001",
        name: "Citizens for Progress",
        sourceSystem: "fec",
      });
    });

    it.each([
      ["S", "candidate"], // FEC senate campaign
      ["N", "pac"], // FEC non-qualified PAC
      ["O", "super_pac"], // FEC IE-only super PAC
      ["Y", "party"], // FEC qualified party
      ["CTL", "candidate"], // CAL-ACCESS controlled committee
      ["BMC", "ballot_measure"], // CAL-ACCESS ballot-measure committee
      ["RCP", "pac"], // CAL-ACCESS recipient committee
      ["GPC", "pac"], // CAL-ACCESS general-purpose committee
      ["candidate", "candidate"], // already-canonical passes through
      ["ZZ", "other"], // unknown code → other
      ["", "other"], // empty code → other (previously dropped by nativeEnum)
    ])(
      "maps roster committee-type code %s → %s (#940)",
      (rawType, expected) => {
        const result = mapper.map(
          createRawResult({
            items: [
              {
                externalId: "C-TYPE",
                name: "Some Committee",
                type: rawType,
                sourceSystem: "cal_access",
              },
            ],
          }),
          createSource({
            dataType: DataType.CAMPAIGN_FINANCE,
            category: "CAL-ACCESS Committees",
          }),
        );

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({ type: expected });
      },
    );

    it("does not drop a roster committee whose type is a raw code (#940)", () => {
      // Regression: z.nativeEnum rejected raw codes, failing the whole
      // CommitteeSchema so the committee was dropped — everything defaulted
      // to OTHER because only stub rows survived.
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "C-KEEP",
              name: "Friends of Jane Doe",
              type: "CTL",
              candidateName: "Doe",
              candidateOffice: "ASM",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "CAL-ACCESS Committees",
        }),
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        externalId: "C-KEEP",
        name: "Friends of Jane Doe",
        type: "candidate",
        candidateName: "Doe",
        candidateOffice: "ASM",
      });
    });

    it("defaults an absent type to other (preserves the old .default behavior) (#940)", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            { externalId: "C-NOTYPE", name: "No Type Co", sourceSystem: "fec" },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "FEC Committees",
        }),
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ type: "other" });
    });
  });

  describe("campaign finance — contributions", () => {
    it("should map valid contribution records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CONT-1",
              committeeId: "C001",
              donorName: "Jane Smith",
              donorType: "IND",
              amount: "500",
              date: "2026-01-15",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "contribution",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        externalId: "CONT-1",
        donorName: "Jane Smith",
        amount: 500,
      });
    });

    it("should construct donorName from firstName+lastName", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CONT-2",
              committeeId: "C001",
              donorLastName: "Smith",
              donorFirstName: "Jane",
              amount: "250",
              date: "2026-02-01",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "contribution",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        donorName: "Smith, Jane",
      });
    });

    it("should normalize donor type abbreviations", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CONT-3",
              committeeId: "C001",
              donorName: "Test Donor",
              donorType: "IND",
              amount: "100",
              date: "2026-01-01",
              sourceSystem: "cal_access",
            },
            {
              externalId: "CONT-4",
              committeeId: "C001",
              donorName: "Test PAC",
              donorType: "COM",
              amount: "5000",
              date: "2026-01-01",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "contribution",
        }),
      );

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ donorType: "individual" });
      expect(result.items[1]).toMatchObject({ donorType: "committee" });
    });

    it("should reject contributions missing required fields", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              // Missing committeeId, donorName, amount, date
              externalId: "CONT-BAD",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "contribution",
        }),
      );

      expect(result.items).toHaveLength(0);
    });
  });

  describe("campaign finance — expenditures", () => {
    it("should map valid expenditure records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "EXP-1",
              committeeId: "C001",
              payeeName: "Ad Agency LLC",
              amount: "10000",
              date: "2026-03-01",
              purposeDescription: "TV ads",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "expenditure",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        payeeName: "Ad Agency LLC",
        amount: 10000,
      });
    });

    it("should normalize support/oppose values", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "EXP-2",
              committeeId: "C001",
              payeeName: "Firm",
              amount: "5000",
              date: "2026-01-01",
              supportOrOppose: "S",
              sourceSystem: "cal_access",
            },
            {
              externalId: "EXP-3",
              committeeId: "C001",
              payeeName: "Other Firm",
              amount: "3000",
              date: "2026-01-01",
              supportOrOppose: "O",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "expenditure",
        }),
      );

      expect(result.items[0]).toMatchObject({ supportOrOppose: "support" });
      expect(result.items[1]).toMatchObject({ supportOrOppose: "oppose" });
    });

    // #633: CalAccess BAL_NAME is misused by filers for committee names,
    // party names, city names, etc. on non-ballot-measure expenditures.
    // Real ballot-measure rows always carry BAL_NUM too — gate
    // propositionTitle on its presence.
    describe("propositionTitle gating on ballotNumber (#633)", () => {
      const buildExpenditure = (overrides: Record<string, unknown>) => ({
        externalId: "EXP-GATE",
        committeeId: "C001",
        payeeName: "Vendor",
        amount: "100",
        date: "2026-01-01",
        propositionTitle: "California Republican Party",
        sourceSystem: "cal_access",
        ...overrides,
      });

      const mapOne = (raw: Record<string, unknown>) =>
        mapper.map(
          createRawResult({ items: [raw] }),
          createSource({
            dataType: DataType.CAMPAIGN_FINANCE,
            category: "expenditure",
          }),
        );

      it("drops propositionTitle when ballotNumber is absent (filer noise)", () => {
        const result = mapOne(buildExpenditure({}));
        expect(result.items[0]).toMatchObject({ payeeName: "Vendor" });
        expect(
          (result.items[0] as { propositionTitle?: string }).propositionTitle,
        ).toBeUndefined();
      });

      it("drops propositionTitle when ballotNumber is null", () => {
        const result = mapOne(buildExpenditure({ ballotNumber: null }));
        expect(
          (result.items[0] as { propositionTitle?: string }).propositionTitle,
        ).toBeUndefined();
      });

      it("drops propositionTitle when ballotNumber is an empty string", () => {
        const result = mapOne(buildExpenditure({ ballotNumber: "   " }));
        expect(
          (result.items[0] as { propositionTitle?: string }).propositionTitle,
        ).toBeUndefined();
      });

      it("keeps propositionTitle when ballotNumber is populated (real measure)", () => {
        const result = mapOne(
          buildExpenditure({
            ballotNumber: "10",
            propositionTitle: "Medi-Cal Funding and Accountability Act",
          }),
        );
        expect(
          (result.items[0] as { propositionTitle?: string }).propositionTitle,
        ).toBe("Medi-Cal Funding and Accountability Act");
      });

      it("never leaks the transient ballotNumber field into the output", () => {
        const result = mapOne(buildExpenditure({ ballotNumber: "10" }));
        expect(result.items[0]).not.toHaveProperty("ballotNumber");
      });
    });
  });

  describe("campaign finance — independent expenditures", () => {
    it("should map valid independent expenditure records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "IE-1",
              committeeId: "C001",
              committeeName: "Super PAC",
              candidateName: "Jane Doe",
              supportOrOppose: "S",
              amount: "50000",
              date: "2026-06-01",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "independent-expenditure",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        committeeName: "Super PAC",
        candidateName: "Jane Doe",
        supportOrOppose: "support",
        amount: 50000,
      });
    });
  });

  describe("campaign finance — category routing", () => {
    it("should default to contribution mapping when category is unrecognized", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "X-1",
              committeeId: "C001",
              donorName: "Default Donor",
              amount: "100",
              date: "2026-01-01",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "unknown-category",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        donorName: "Default Donor",
      });
    });

    it("should route s496 category to independent expenditures", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "IE-S496",
              committeeId: "C001",
              committeeName: "Late IE PAC",
              supportOrOppose: "O",
              amount: "25000",
              date: "2026-10-01",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "cal-access-s496",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        committeeName: "Late IE PAC",
        supportOrOppose: "oppose",
      });
    });

    it("routes 'Committee Positions' (CVR2/Form 410) to measure filings, not committees (#936)", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CVR2-1",
              filingId: "F123",
              ballotName: "Clean Water Act",
              ballotNumber: "Prop 5",
              ballotJurisdiction: "STATEWIDE",
              supportOrOppose: "S",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          // Category contains "committee" — must NOT misroute to mapCommittee.
          category: "CAL-ACCESS Committee Positions",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        externalId: "CVR2-1",
        filingId: "F123",
        ballotName: "Clean Water Act",
        ballotNumber: "Prop 5",
        supportOrOppose: "support",
      });
    });

    it("maps an 'O' support/oppose code on a measure filing to oppose (#936)", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CVR2-2",
              filingId: "F200",
              ballotNumber: "Prop 9",
              supportOrOppose: "O",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "CAL-ACCESS Committee Positions",
        }),
      );

      expect(result.items[0]).toMatchObject({ supportOrOppose: "oppose" });
    });

    it("drops a CVR2 row that carries no ballotName/ballotNumber (non-ballot declaration) (#936)", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CVR2-3",
              filingId: "F300",
              // no ballotName, no ballotNumber — entity declaration, not a measure
              supportOrOppose: "S",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "CAL-ACCESS Committee Positions",
        }),
      );

      expect(result.items).toHaveLength(0);
    });

    it("drops a 'Committee Positions' row missing filingId rather than treating it as a committee (#936)", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "x",
              name: "Some PAC",
              type: "OTHER",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "CAL-ACCESS Committee Positions",
        }),
      );

      expect(result.items).toHaveLength(0);
    });
  });
});
