# Petstore API (example collection)

1 request. Generated from the collection with `truspec docs`.

### Get pet by id

`GET {{baseUrl}}/pets/{{petId}}`

Fetch a single pet by its id.

**Spec operation:** `GET /pets/{id}`

**Query parameters**

| Query | Value |
|---|---|
| `expand` | `owner` |

**Asserts**

- `{"type":"status","equals":200}`
- `{"type":"jsonpath","path":"$.id","exists":true}`
- `{"type":"duration","ltMs":1000}`

<details><summary>Example (cURL)</summary>

```bash
curl -X GET '{{baseUrl}}/pets/{{petId}}?expand=owner' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer {{token}}'
```

</details>

<sub>`get-pet.tspec.yaml`</sub>
