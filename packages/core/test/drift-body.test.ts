import { describe, expect, it } from "vitest";
import { collectionOperations } from "../src/spec/collection";
import { computeDrift } from "../src/spec/drift";
import { parseOpenApi } from "../src/spec/openapi";
import { parse } from "../src/format";

const SPEC = `openapi: 3.0.3
info: { title: D, version: "1" }
paths:
  /pets:
    post:
      operationId: createPet
      parameters:
        - { name: X-Api-Version, in: header, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [id, name, species]
              properties:
                id: { type: integer, minimum: 1 }
                name: { type: string, minLength: 2 }
                species: { type: string, enum: [cat, dog] }
                tags: { type: array, items: { type: string }, minItems: 1 }
      responses:
        "201": { description: created }
`;

function driftFor(requestYaml: string): string[] {
  const summary = parseOpenApi(SPEC);
  const req = parse.request.parse(requestYaml);
  const colOps = collectionOperations([{ file: "api/create.tspec.yaml", req }]);
  return computeDrift(summary.operations, colOps, summary.document).changed;
}

const request = (body: string, extra = ""): string =>
  `tspec: "0.1"
name: createPet
method: POST
url: "https://api.test/pets"
headers: { X-Api-Version: "1" }
${extra}body: { type: json, content: ${body} }
assertions: []
spec: { operation: "POST /pets" }
`;

/**
 * `drift` checked that a required query param was present and that a required body *existed*. It
 * never looked inside the body — so a field becoming required, the most ordinary breaking change an
 * API makes, went unreported. Nothing else in the tool catches it either: `contract` validates
 * responses, and the mock's `--validate` needs a server running.
 */
describe("drift checks the request body against the operation's schema", () => {
  it("is clean when the body satisfies the schema", () => {
    expect(driftFor(request('{ id: 1, name: "Rex", species: "cat" }'))).toEqual([]);
  });

  it("reports a property that became required", () => {
    expect(driftFor(request('{ id: 1, name: "Rex" }'))).toEqual([
      "POST /pets: body missing required property 'species'",
    ]);
  });

  it("names the property once, not twice", () => {
    // The violation is reported at `/species`, so a naive `body${path}` prefix said it again.
    const [entry] = driftFor(request('{ id: 1, name: "Rex" }'));
    expect(entry).not.toContain("body/species");
  });

  it("reports a literal value of the wrong type, with its path", () => {
    expect(driftFor(request('{ id: "nope", name: "Rex", species: "cat" }'))).toEqual([
      "POST /pets: body/id expected integer, got string",
    ]);
  });

  it("reports a literal value that violates a constraint the spec sets", () => {
    expect(driftFor(request('{ id: 0, name: "Rex", species: "cat" }'))[0]).toContain("0 is less than minimum 1");
    expect(driftFor(request('{ id: 1, name: "R", species: "cat" }'))[0]).toContain("less than minLength 2");
    expect(driftFor(request('{ id: 1, name: "Rex", species: "fish" }'))[0]).toContain("not one of the allowed enum");
  });

  it("reports a nested violation at its full path", () => {
    expect(driftFor(request('{ id: 1, name: "Rex", species: "cat", tags: [] }'))[0]).toContain(
      "body/tags array has 0 item(s), fewer than minItems 1",
    );
  });
});

/**
 * A body is authored with variables still in it, so validating it literally would report
 * `"{{petId}}"` as failing `type: integer`. A drift check that cries wolf is one someone turns off.
 */
describe("a {{template}} is not drift", () => {
  it("says nothing about a templated value the spec types differently", () => {
    expect(driftFor(request('{ id: "{{petId}}", name: "Rex", species: "cat" }'))).toEqual([]);
  });

  it("says nothing about a value inside a templated container", () => {
    expect(driftFor(request('{ id: 1, name: "Rex", species: "cat", tags: "{{tagList}}" }'))).toEqual([]);
  });

  it("says nothing when the whole body is one variable", () => {
    expect(driftFor(request('"{{wholeBody}}"'))).toEqual([]);
  });

  it("still reports a missing required property, which no template could supply", () => {
    // The one violation a template cannot explain: its path names a key that is simply not there.
    expect(driftFor(request('{ id: "{{petId}}", name: "Rex" }'))).toEqual([
      "POST /pets: body missing required property 'species'",
    ]);
  });

  it("still reports a literal sibling of a templated value", () => {
    expect(driftFor(request('{ id: "{{petId}}", name: "R", species: "cat" }'))[0]).toContain("minLength 2");
  });
});

describe("drift checks required header parameters", () => {
  it("reports one the request does not set", () => {
    const without = `tspec: "0.1"
name: createPet
method: POST
url: "https://api.test/pets"
body: { type: json, content: { id: 1, name: "Rex", species: "cat" } }
assertions: []
spec: { operation: "POST /pets" }
`;
    expect(driftFor(without)).toEqual(["POST /pets: missing required header 'X-Api-Version'"]);
  });

  it("matches the header name case-insensitively, as HTTP does", () => {
    expect(driftFor(request('{ id: 1, name: "Rex", species: "cat" }').replace("X-Api-Version", "x-api-version"))).toEqual(
      [],
    );
  });
});

describe("a non-JSON body is left alone", () => {
  it("reports only its absence, never its contents", () => {
    const text = `tspec: "0.1"
name: createPet
method: POST
url: "https://api.test/pets"
headers: { X-Api-Version: "1" }
body: { type: text, content: "raw" }
assertions: []
spec: { operation: "POST /pets" }
`;
    // A text body cannot be validated against a JSON schema, and guessing would be worse than
    // silence. The body is present, so there is nothing to report.
    expect(driftFor(text)).toEqual([]);
  });
});
