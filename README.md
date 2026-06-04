# Smart Text Slicer

A Power BI custom visual providing a searchable dropdown slicer with multi-select support and asynchronous data loading for large datasets.

## Features

- **Searchable dropdown** — type anywhere in the field to filter suggestions instantly (case-insensitive, substring match)
- **Multi-select** — select multiple values across multiple searches; filters combine with OR logic
- **Selected values pinned at top** — checked items stay visible at the top of the list regardless of the current search
- **Select all / deselect all** — applies to the currently visible (filtered) items only
- **Async data loading** — data is fetched in chunks of 30 000 rows via `fetchMoreData`; a spinner indicates loading progress
- **Persistent selections** — selected values are saved inside the `.pbix` file and restored on report reopen, exactly like native slicers
- **One data field** — bind a single column; the visual handles deduplication and sorting automatically

## Data Binding

| Role | Kind | Max fields |
|---|---|---|
| **Field** | Grouping (text or number) | 1 |

Drag any column onto the **Field** data role. The visual reads all unique values from that column and uses them as filter candidates.

## Usage

1. Import `SmartTextSlicer.pbiviz` from the **Releases** page into your Power BI Desktop via **Insert → More visuals → Import a visual from a file**.
2. Add the visual to your report canvas.
3. Drag a column to the **Field** well.
4. Click the dropdown, type to search, and click values to select them.
5. The report filters immediately on each selection change (OR logic across all selected values).
6. To clear all filters, open the dropdown, click **Select all** to check everything, then click again to uncheck all — or use the visual's context menu **Revert to default**.

## Security & Privacy

### No External Communication

The visual declares zero network privileges. It makes no `fetch`, `WebSocket`, or any other network request. All data flows exclusively through Power BI's standard dataView API. There is no telemetry, no analytics, and no third-party service contact of any kind.

### Safe DOM Rendering

Every DOM element is created with `document.createElement`. Text content is assigned via `element.textContent` only. The visual never uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function`. This eliminates the class of XSS vulnerabilities that affect visuals built with template strings or jQuery.

### Dependencies

The packaged `.pbiviz` file bundles **one Microsoft-published runtime package**:

| Package | Publisher | Purpose |
|---|---|---|
| `powerbi-visuals-api` | Microsoft | IVisual interface, host APIs, and type definitions |

The `BasicFilter` structure is implemented inline as a plain JSON object matching Power BI's `http://powerbi.com/product/schema#basic` schema — no external filter library is required.

Build tools (`powerbi-visuals-tools`, `typescript`, `eslint`) are dev-only and are never included in the packaged visual.

### Automated Security Gates

Every commit and pull request runs the following checks in CI before a package can be produced:

| Gate | What it enforces |
|---|---|
| `npm audit --audit-level=high` | Fails the build on any high or critical severity vulnerability in the dependency tree |
| `node scripts/check-security.js` | Scans TypeScript source for forbidden APIs (`innerHTML`, `eval`, `fetch`, `WebSocket`, `XMLHttpRequest`, `document.write`, remote `require`) and validates that all runtime dependencies are from approved Microsoft publishers |
| `tsc --noEmit` | Full TypeScript type check — no type errors allowed |
| `eslint` | Lint rules enforced |

A `.pbiviz` artifact is only produced if all four gates pass.

### Filter Persistence

Applied filters are saved within the `.pbix` report file using Power BI's standard `persistProperties` and `applyJsonFilter` APIs, the same mechanism used by native slicers. Selected values are serialised as JSON and stored in the visual's `general.selection` property. No data leaves the Power BI environment.

## Build

The visual is built in CI on every push. To build locally:

```bash
npm install
npm run package   # outputs dist/smartTextSlicer.pbiviz
```

Requires Node.js 20+ and internet access to download `powerbi-visuals-tools`.

## License

[MIT](LICENSE)
