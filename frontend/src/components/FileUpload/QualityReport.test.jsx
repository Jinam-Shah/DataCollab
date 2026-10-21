import { render, screen } from '@testing-library/react';
import QualityReport from './QualityReport';

const report = {
  rowCount: 5,
  columnCount: 2,
  duplicateRows: 1,
  warnings: [
    {
      column: 'code',
      kind: 'mixed_types',
      message: '"code" mixes 40% numbers, 60% text; stored as TEXT',
    },
    { column: null, kind: 'duplicate_rows', message: '1 duplicate row(s) (20%)' },
  ],
  columns: [
    { sqlName: 'amount', type: 'FLOAT', emptyPct: 20, mixedTypes: false, min: -3, max: 100 },
    { sqlName: 'code', type: 'TEXT', emptyPct: 0, mixedTypes: true, min: null, max: null },
  ],
};

it('lists warnings and per-column stats', () => {
  render(<QualityReport report={report} />);
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.getByText(/mixes 40% numbers/)).toBeInTheDocument();
  expect(screen.getByText('5 rows, 2 columns, 1 duplicate rows')).toBeInTheDocument();
  const amountRow = screen.getByText('amount').closest('tr');
  expect(amountRow).toHaveTextContent('FLOAT20%no-3100');
  expect(screen.getByText('code').closest('tr')).toHaveClass('bg-amber-50');
});

it('renders nothing without a report', () => {
  const { container } = render(<QualityReport report={null} />);
  expect(container).toBeEmptyDOMElement();
});
