"use strict";

import powerbi from "powerbi-visuals-api";

type VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
type VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
type IVisual = powerbi.extensibility.visual.IVisual;
type IVisualHost = powerbi.extensibility.visual.IVisualHost;
type DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
type DataView = powerbi.DataView;

// Matches Power BI's BasicFilter JSON schema — no external package required.
interface IFilterColumnTarget {
    table: string;
    column: string;
}

interface IBasicFilter {
    $schema: string;
    target: IFilterColumnTarget;
    filterType: number; // 1 = Basic
    operator: string;   // "In"
    values: (string | number | boolean)[];
}

interface Elements {
    root: HTMLElement;
    header: HTMLElement;
    input: HTMLInputElement;
    badge: HTMLElement;
    arrow: HTMLElement;
    dropdown: HTMLElement;
    selectAllItem: HTMLElement;
    selectAllCheck: HTMLElement;
    list: HTMLElement;
    loader: HTMLElement;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private el!: Elements;

    private allValues: string[] = [];
    private selectedValues: Set<string> = new Set();
    private filterTarget: IFilterColumnTarget | null = null;
    private filterTargetKey: string = "";

    private isLoading: boolean = false;
    private isOpen: boolean = false;
    private initialized: boolean = false;
    private searchText: string = "";

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.buildDOM(options.element);
        this.bindEvents();
    }

    // ─── DOM ─────────────────────────────────────────────────────────────────

    private buildDOM(container: HTMLElement): void {
        const root = this.div("sts-root");

        const header = this.div("sts-header");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "sts-input";
        input.setAttribute("placeholder", "Search...");
        input.setAttribute("autocomplete", "off");
        input.setAttribute("spellcheck", "false");

        const badge = this.span("sts-badge");
        badge.style.display = "none";

        const arrow = this.span("sts-arrow");
        arrow.textContent = "▼";

        header.appendChild(input);
        header.appendChild(badge);
        header.appendChild(arrow);

        const dropdown = this.div("sts-dropdown");
        dropdown.style.display = "none";

        const selectAllItem = this.div("sts-item sts-select-all");
        const selectAllCheck = this.span("sts-check");
        const selectAllLabel = this.span("sts-label");
        selectAllLabel.textContent = "Select all";
        selectAllItem.appendChild(selectAllCheck);
        selectAllItem.appendChild(selectAllLabel);

        const topSep = this.div("sts-separator");

        const list = this.div("sts-list");

        const loader = this.div("sts-loader");
        loader.style.display = "none";
        const spinner = this.span("sts-spinner");
        const loaderText = this.span("");
        loaderText.textContent = "Loading...";
        loader.appendChild(spinner);
        loader.appendChild(loaderText);

        dropdown.appendChild(selectAllItem);
        dropdown.appendChild(topSep);
        dropdown.appendChild(list);
        dropdown.appendChild(loader);

        root.appendChild(header);
        root.appendChild(dropdown);
        container.appendChild(root);

        this.el = { root, header, input, badge, arrow, dropdown, selectAllItem, selectAllCheck, list, loader };
    }

    private div(cls: string): HTMLDivElement {
        const el = document.createElement("div");
        if (cls) el.className = cls;
        return el;
    }

    private span(cls: string): HTMLSpanElement {
        const el = document.createElement("span");
        if (cls) el.className = cls;
        return el;
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    private bindEvents(): void {
        this.el.header.addEventListener("click", (e) => {
            if (e.target === this.el.input) return;
            this.toggleDropdown();
        });

        this.el.input.addEventListener("focus", () => {
            if (!this.isOpen) this.openDropdown();
        });

        this.el.input.addEventListener("input", () => {
            this.searchText = this.el.input.value;
            this.renderList();
        });

        this.el.selectAllItem.addEventListener("click", () => this.handleSelectAll());

        document.addEventListener("click", (e) => {
            if (!this.el.root.contains(e.target as Node)) {
                this.closeDropdown();
            }
        });
    }

    // ─── Power BI update lifecycle ───────────────────────────────────────────

    public update(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        const category = dataView?.categorical?.categories?.[0];

        if (!category) {
            this.allValues = [];
            this.isLoading = false;
            this.hideLoader();
            this.renderList();
            return;
        }

        // Detect column change → reset state
        const newKey = category.source.queryName ?? category.source.displayName;
        if (newKey !== this.filterTargetKey) {
            this.filterTargetKey = newKey;
            this.filterTarget = this.buildFilterTarget(category);
            this.selectedValues.clear();
            this.initialized = false;
        }

        // With aggregateSegments:true, Power BI accumulates data before each update.
        // We rebuild allValues from the growing snapshot on each call.
        this.allValues = this.extractUniqueValues(category);

        // Request next segment — returns false when all data is loaded.
        const hasMore = this.host.fetchMoreData(true);
        this.isLoading = hasMore;

        if (!hasMore) {
            this.hideLoader();
            if (!this.initialized) {
                this.initialized = true;
                this.restoreSelection(dataView);
            }
        } else {
            this.showLoader();
        }

        this.renderList();
        this.updateHeader();
    }

    private extractUniqueValues(category: DataViewCategoryColumn): string[] {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const v of category.values) {
            if (v !== null && v !== undefined) {
                const s = String(v);
                if (!seen.has(s)) {
                    seen.add(s);
                    result.push(s);
                }
            }
        }
        result.sort((a, b) => a.localeCompare(b));
        return result;
    }

    private buildFilterTarget(category: DataViewCategoryColumn): IFilterColumnTarget {
        const qn = category.source.queryName;
        if (!qn) {
            return { table: "", column: category.source.displayName };
        }
        const dot = qn.indexOf(".");
        return dot > -1
            ? { table: qn.substring(0, dot), column: qn.substring(dot + 1) }
            : { table: qn, column: category.source.displayName };
    }

    private restoreSelection(dataView: DataView): void {
        try {
            const raw = dataView.metadata?.objects?.["general"]?.["selection"];
            const stored = (raw as unknown) as string | undefined;
            if (stored) {
                const parsed = JSON.parse(stored) as string[];
                this.selectedValues = new Set(parsed);
            }
        } catch {
            this.selectedValues = new Set();
        }
    }

    // ─── Rendering ───────────────────────────────────────────────────────────

    private renderList(): void {
        const list = this.el.list;
        while (list.firstChild) list.removeChild(list.firstChild);

        const search = this.searchText.toLowerCase();

        const selected: string[] = [];
        const unselected: string[] = [];

        for (const val of this.allValues) {
            const matches = search === "" || val.toLowerCase().includes(search);
            if (!matches) continue;
            if (this.selectedValues.has(val)) selected.push(val);
            else unselected.push(val);
        }

        for (const val of selected) list.appendChild(this.createItem(val, true));

        if (selected.length > 0 && unselected.length > 0) {
            list.appendChild(this.div("sts-separator sts-list-sep"));
        }

        for (const val of unselected) list.appendChild(this.createItem(val, false));

        if (selected.length === 0 && unselected.length === 0 && !this.isLoading) {
            const empty = this.div("sts-empty");
            empty.textContent = this.allValues.length === 0 ? "No data bound" : "No results";
            list.appendChild(empty);
        }

        this.updateSelectAllState(selected.length, unselected.length);
    }

    private createItem(value: string, checked: boolean): HTMLElement {
        const item = this.div("sts-item" + (checked ? " sts-item--checked" : ""));

        const check = this.span("sts-check" + (checked ? " sts-check--on" : ""));
        const label = this.span("sts-label");
        label.textContent = value;

        item.appendChild(check);
        item.appendChild(label);
        item.addEventListener("click", () => this.toggleValue(value));

        return item;
    }

    private updateSelectAllState(selectedCount: number, unselectedCount: number): void {
        const total = selectedCount + unselectedCount;
        const check = this.el.selectAllCheck;

        if (total === 0) {
            check.className = "sts-check";
        } else if (selectedCount === total) {
            check.className = "sts-check sts-check--on";
        } else if (selectedCount > 0) {
            check.className = "sts-check sts-check--partial";
        } else {
            check.className = "sts-check";
        }
    }

    private updateHeader(): void {
        const count = this.selectedValues.size;
        this.el.badge.style.display = count > 0 ? "inline" : "none";
        this.el.badge.textContent = String(count);
    }

    // ─── Selection logic ─────────────────────────────────────────────────────

    private toggleValue(value: string): void {
        if (this.selectedValues.has(value)) this.selectedValues.delete(value);
        else this.selectedValues.add(value);

        this.renderList();
        this.updateHeader();
        this.applyFilter();
        this.persistSelection();
    }

    private handleSelectAll(): void {
        const search = this.searchText.toLowerCase();
        const visible = this.allValues.filter(v => search === "" || v.toLowerCase().includes(search));
        const allChecked = visible.every(v => this.selectedValues.has(v));

        if (allChecked) visible.forEach(v => this.selectedValues.delete(v));
        else visible.forEach(v => this.selectedValues.add(v));

        this.renderList();
        this.updateHeader();
        this.applyFilter();
        this.persistSelection();
    }

    // ─── Filter & persistence ─────────────────────────────────────────────────

    private applyFilter(): void {
        if (!this.filterTarget) return;

        const values = Array.from(this.selectedValues);

        if (values.length === 0) {
            // Empty cast: IFilter is an empty interface, any object satisfies it.
            // FilterAction.remove clears the filter regardless of the filter value.
            this.host.applyJsonFilter(
                {} as powerbi.IFilter,
                "general",
                "filter",
                powerbi.FilterAction.remove
            );
            return;
        }

        const filter: IBasicFilter = {
            $schema: "http://powerbi.com/product/schema#basic",
            target: this.filterTarget,
            filterType: 1,
            operator: "In",
            values
        };

        this.host.applyJsonFilter(
            filter as unknown as powerbi.IFilter,
            "general",
            "filter",
            powerbi.FilterAction.merge
        );
    }

    private persistSelection(): void {
        const values = Array.from(this.selectedValues);
        this.host.persistProperties({
            merge: [{
                objectName: "general",
                properties: { selection: JSON.stringify(values) },
                // null selector = visual-level property (not data-point bound)
                selector: null as unknown as powerbi.data.Selector
            }]
        });
    }

    // ─── Dropdown ────────────────────────────────────────────────────────────

    private toggleDropdown(): void {
        if (this.isOpen) this.closeDropdown();
        else this.openDropdown();
    }

    private openDropdown(): void {
        this.isOpen = true;
        this.el.dropdown.style.display = "block";
        this.el.arrow.textContent = "▲";
        this.el.input.focus();
    }

    private closeDropdown(): void {
        this.isOpen = false;
        this.el.dropdown.style.display = "none";
        this.el.arrow.textContent = "▼";
    }

    private showLoader(): void { this.el.loader.style.display = "flex"; }
    private hideLoader(): void { this.el.loader.style.display = "none"; }
}
