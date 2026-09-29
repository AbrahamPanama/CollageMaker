export const STUD_PITCH_MM = 8;
export const CELL_STUDS = 1;
export const CELL_SIZE_MM = STUD_PITCH_MM * CELL_STUDS;
export const BRICK_HEIGHT_MM = 9.6;
export const PLATE_HEIGHT_MM = 3.2;
export const STUD_DIAMETER_MM = 4.8;
export const STUD_HEIGHT_MM = 1.8;
export const DEFAULT_PRINT_DPI = 300;

export function mmToPx(mm: number, dpi = DEFAULT_PRINT_DPI) {
  return (mm / 25.4) * dpi;
}

export function panelSizeMm(cols: number, rows: number) {
  return {
    width: cols * CELL_SIZE_MM,
    height: rows * BRICK_HEIGHT_MM,
  };
}
