import { formatApprovalRequest } from '../tools/approvalFormatter.js';

// The approval card is the one place a non-developer has to understand exactly what the
// agent is about to do, so these freeze the wording produced for each dangerous tool.

const adminforth = {
  config: {
    resources: [
      {
        resourceId: 'cars_sl',
        label: 'Cars',
        columns: [
          { name: 'id', primaryKey: true },
          { name: 'brand', label: 'Brand' },
          { name: 'model_year' },
          { name: 'is_sold', label: 'Sold' },
          { name: 'body_type', label: 'Body type', enum: [{ value: 'suv', label: 'SUV' }] },
          { name: 'vin_code', label: 'VIN', masked: true },
        ],
        options: { actions: [{ id: 'send_invoice', name: 'Send invoice' }] },
      },
    ],
  },
} as any;

describe('formatApprovalRequest', () => {
  it('names the resource and every column by its label', () => {
    expect(formatApprovalRequest(adminforth, {
      toolName: 'create_record',
      args: {
        resourceId: 'cars_sl',
        record: { brand: 'Tesla', model_year: 2024, is_sold: false, body_type: 'suv', vin_code: 'XYZ' },
        requiredColumnsToSkip: ['x'],
      },
    })).toBe(
      'Create a new record in Cars — Brand: Tesla, Model year: 2024, Sold: No, Body type: SUV, VIN: ••••••',
    );
  });

  it('spells out the update as the values being set', () => {
    expect(formatApprovalRequest(adminforth, {
      toolName: 'update_record',
      args: { resourceId: 'cars_sl', recordId: '10', record: { brand: 'Ford' } },
    })).toBe('Update record with id:10 in Cars — set Brand: Ford');
  });

  it('warns that a delete cannot be undone', () => {
    expect(formatApprovalRequest(adminforth, {
      toolName: 'delete_record',
      args: { resourceId: 'cars_sl', primaryKey: '10' },
    })).toBe('Delete record with id:10 from Cars — this cannot be undone');
  });

  it('uses the action name rather than its id', () => {
    expect(formatApprovalRequest(adminforth, {
      toolName: 'start_custom_action',
      args: { resourceId: 'cars_sl', actionId: 'send_invoice', recordId: '10' },
    })).toBe('Run "Send invoice" on record 10 in Cars');
  });

  it('counts the records a bulk action would touch', () => {
    expect(formatApprovalRequest(adminforth, {
      toolName: 'start_custom_bulk_action',
      args: { resourceId: 'cars_sl', actionId: 'archive', recordIds: ['1', '2', '3'] },
    })).toBe('Run "Archive" on 3 record(s) in Cars');
  });

  it('falls back to the resource id when the resource is unknown', () => {
    expect(formatApprovalRequest(adminforth, {
      toolName: 'delete_record',
      args: { resourceId: 'ghosts', primaryKey: '1' },
    })).toBe('Delete record with id:1 from ghosts — this cannot be undone');
  });

  it('dumps the arguments as key/value pairs for an unrecognized tool', () => {
    expect(formatApprovalRequest(adminforth, {
      toolName: 'wipe_everything',
      args: { target: 'all', dry_run: true },
    })).toBe('Wipe everything — Target: all, Dry run: Yes');
  });

  it('reports blank values as empty instead of dropping them', () => {
    expect(formatApprovalRequest(adminforth, {
      toolName: 'update_record',
      args: { resourceId: 'cars_sl', recordId: '10', record: { brand: null } },
    })).toBe('Update record with id:10 in Cars — set Brand: empty');
  });
});
