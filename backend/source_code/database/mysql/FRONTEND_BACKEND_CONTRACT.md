# Frontend-backend database contract

The frontend backend mode uses `POST /api/db/rpc` with a JSON request body.

```json
{"method":"getTableData","tableName":"cows"}
```

The response has the form:

```json
{"code":200,"msg":"success","data":[]}
```

Supported methods are `getTableData`, `updateTableData`, `addTableData`,
`updateTableRecord`, `deleteTableRecord`, `clearTableData`, `getDataStats`, and
`resetDatabase`. Request fields and return types are defined by the handler
implementations in `scripts/`.

Frontend names with hyphens map to MySQL names with underscores. Domain calls
use `/api/cow/{scope}/{method}` for the `cow`, `sensor`, `event`, `baseData`,
`statistics`, `export`, `milk`, `feed`, `reproduction`, `health`, `automation`,
`economic`, `predictive`, `hardware`, and `kpi` scopes.
