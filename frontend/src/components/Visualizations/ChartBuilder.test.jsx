import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChartBuilder from './ChartBuilder';

const results = {
  data: [
    { region: 'north', total: '15' },
    { region: 'south', total: '20' },
  ],
  columns: ['region', 'total'],
};

it('renders nothing without results', () => {
  const { container } = render(<ChartBuilder queryResults={null} />);
  expect(container).toBeEmptyDOMElement();
});

it('offers the result columns as axes and builds a chart once both are picked', async () => {
  render(<ChartBuilder queryResults={results} />);
  expect(screen.getByText(/Select X and Y axes/)).toBeInTheDocument();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('X axis'), 'region');
  await user.selectOptions(screen.getByLabelText('Y axis'), 'total');
  expect(screen.queryByText(/Select X and Y axes/)).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Chart type'), 'pie');
  expect(screen.getByLabelText('Chart type')).toHaveValue('pie');
});
