import type { ProductIR } from "../solution/ir/types.js";

// Public development contract fixture only. No domain vocabulary from this file
// is imported by reusable compiler or runtime modules.
export const PUBLIC_BOOK_LENDING_IR: ProductIR = {
  version: "1",
  product: {
    name: "Shelf Keeper",
    description: "Track a personal book collection and see which books are currently borrowed.",
    tagline: "Know what is on your shelf—and what is out.",
    targetUser: "A household member managing a personal book collection",
    genome: "tracker",
    accent: "#6d4c41",
  },
  entities: [{
    name: "book",
    plural: "books",
    primaryField: "title",
    fields: [
      { id: "title", label: "Title", type: "text", required: true },
      { id: "author", label: "Author", type: "text", required: true },
      { id: "category", label: "Category", type: "category", required: true, options: ["Novel", "Cookbook", "Reference", "Biography", "Other"], allowCustom: true },
      { id: "borrower", label: "Borrowed by", type: "text", required: false, placeholder: "Leave blank when on the shelf" },
    ],
  }],
  capabilities: { create: true, edit: true, delete: true, search: true, filter: true, sort: true, group: true, transition: true, calculate: true },
  filters: [{ id: "lent_out", label: "Currently lent out", field: "borrower", operator: "nonEmpty" }],
  calculations: [
    { id: "total", label: "Total books", operation: "count" },
    { id: "lent", label: "Lent out", operation: "countWhere", field: "borrower", operator: "nonEmpty" },
  ],
  charts: [],
  persistence: { strategy: "localStorage" },
  assumptions: ["Category suggestions accept custom values because the requested categories are approximate", "Clearing the borrower marks a book as returned"],
  excluded: ["Authentication", "Cloud synchronization", "Multi-user accounts"],
  customRequirements: [],
};
