import type { DropTarget } from "./model";

/**
 * Where a dragged widget would land, from the pointer and the board's boxes
 * (measured once when the drag starts, in page coordinates, so scrolling
 * during the drag needs no re-measuring). Pure — unit tested.
 *
 *  - the gap between rows, a row's top/bottom edge → a new row there
 *  - a column's left/right edge, the gap between columns, a row's free room →
 *    a new column there
 *  - anywhere else over a column → into its stack, above the first card whose
 *    middle is below the pointer
 */

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MeasuredBoard {
  box: Box;
  rows: Array<{
    id: string;
    box: Box;
    columns: Array<{ id: string; box: Box; widgets: Array<{ id: string; box: Box }> }>;
  }>;
}

/** The insertion line to draw, in page coordinates. */
export interface DropLine {
  orientation: "horizontal" | "vertical";
  x: number;
  y: number;
  length: number;
}

export interface DropHit {
  target: DropTarget;
  line: DropLine;
}

/** Height of a row's top/bottom band that means "new row" (capped for short rows). */
const ROW_EDGE = 28;
/** Width of a column's side band that means "new column beside it". */
const COLUMN_EDGE = 64;

export function hitTest(board: MeasuredBoard, x: number, y: number, gap: number): DropHit | null {
  const { rows } = board;
  const width = board.box.right - board.box.left;
  const rowLine = (index: number): DropHit => {
    const y =
      rows.length === 0
        ? board.box.top
        : index === 0
          ? rows[0].box.top - gap / 2
          : index >= rows.length
            ? rows[rows.length - 1].box.bottom + gap / 2
            : (rows[index - 1].box.bottom + rows[index].box.top) / 2;
    return {
      target: { kind: "row", beforeRowId: rows[index]?.id ?? null },
      line: { orientation: "horizontal", x: board.box.left, y, length: width },
    };
  };

  if (rows.length === 0) return rowLine(0);

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (y < row.box.top) return rowLine(index);
    if (y > row.box.bottom) continue;

    const height = row.box.bottom - row.box.top;
    const edge = Math.min(ROW_EDGE, height * 0.15);
    if (y < row.box.top + edge) return rowLine(index);
    if (y > row.box.bottom - edge) return rowLine(index + 1);

    const { columns } = row;
    const columnLine = (at: number): DropHit => {
      const x =
        at === 0
          ? columns[0].box.left - gap / 2
          : at >= columns.length
            ? columns[columns.length - 1].box.right + gap / 2
            : (columns[at - 1].box.right + columns[at].box.left) / 2;
      return {
        target: { kind: "column", rowId: row.id, beforeColumnId: columns[at]?.id ?? null },
        line: { orientation: "vertical", x, y: row.box.top, length: height },
      };
    };

    for (let at = 0; at < columns.length; at++) {
      const column = columns[at].box;
      if (x < column.left) return columnLine(at);
      if (x > column.right) continue;
      const side = Math.min(COLUMN_EDGE, (column.right - column.left) * 0.22);
      if (x < column.left + side) return columnLine(at);
      if (x > column.right - side) return columnLine(at + 1);

      const { widgets } = columns[at];
      const before = widgets.findIndex((widget) => y < (widget.box.top + widget.box.bottom) / 2);
      const lineY =
        widgets.length === 0
          ? column.top
          : before === 0
            ? widgets[0].box.top - gap / 2
            : before === -1
              ? widgets[widgets.length - 1].box.bottom + gap / 2
              : (widgets[before - 1].box.bottom + widgets[before].box.top) / 2;
      return {
        target: { kind: "stack", columnId: columns[at].id, beforeWidgetId: before === -1 ? null : widgets[before].id },
        line: { orientation: "horizontal", x: column.left, y: lineY, length: column.right - column.left },
      };
    }
    // Right of the last column: the row's free room.
    return columnLine(columns.length);
  }
  return rowLine(rows.length);
}
