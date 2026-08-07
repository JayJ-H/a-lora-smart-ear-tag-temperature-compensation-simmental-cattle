# Frontend-backend database contract

The frontend backend mode uses the RPC endpoint below.

```text
POST /api/db/rpc
Content-Type: application/json
```

Example request:

```json
{"method":"getTableData","tableName":"cows"}
```

Example response:

```json
{"code":200,"msg":"success","data":[]}
```

## RPC methods

| Method | Request fields | Return value |
| --- | --- | --- |
| `getTableData` | `tableName` | `any[]` |
| `updateTableData` | `tableName`, `data` | `boolean` |
| `addTableData` | `tableName`, `data` | `boolean` |
| `updateTableRecord` | `tableName`, `id`, `updatedRecord` | `boolean` |
| `deleteTableRecord` | `tableName`, `id` | `boolean` |
| `clearTableData` | `tableName` | `boolean` |
| `getDataStats` | none | `Record<string, number>` |
| `resetDatabase` | none | `boolean` |

Frontend names with hyphens map to MySQL names with underscores. Domain calls
use `/api/cow/{scope}/{method}` for the `cow`, `sensor`, `event`, `baseData`,
`statistics`, `export`, `milk`, `feed`, `reproduction`, `health`, `automation`,
`economic`, `predictive`, `hardware`, and `kpi` scopes.
