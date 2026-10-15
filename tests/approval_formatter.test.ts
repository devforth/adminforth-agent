import { formatApprovalRequest } from '../tools/approvalFormatter.js';

// The approval card is the one place a non-developer has to understand exactly what the
// agent is about to do, so these freeze the wording produced for each dangerous tool.

const storedCars: Record<string, Record<string, unknown>> = {
  '10': { id: '10', brand: 'Toyota', body_type: 'suv', vin_code: 'OLD-VIN' },
};

const adminforth = {
  config: {
    resources: [
      {
        resourceId: 'cars_sl',
        label: 'Cars',
        dataSource: 'maindb',
        columns: [
          { name: 'id', primaryKey: true },
          { name: 'brand', label: 'Brand' },
          { name: 'model_year' },
          { name: 'is_sold', label: 'Sold' },
          { name: 'body_type', label: 'Body type', enum: [{ value: 'suv', label: 'SUV' }, { value: 'sedan', label: 'Sedan' }] },
          { name: 'vin_code', label: 'VIN', masked: true },
        ],
        options: { actions: [{ id: 'send_invoice', name: 'Send invoice' }] },
      },
    ],
  },
  connectors: {
    maindb: {
      getRecordByPrimaryKey: async (_resource: unknown, recordId: string) => {
        if (recordId === 'unreachable') {
          throw new Error('connection lost');
        }
        return storedCars[recordId] ?? null;
      },
    },
  },
} as any;

describe('formatApprovalRequest', () => {
  it('names the resource and every column by its label', async () => {
    expect(await formatApprovalRequest(adminforth, {
      toolName: 'create_record',
      args: {
        resourceId: 'cars_sl',
        record: { brand: 'Tesla', model_year: 2024, is_sold: false, body_type: 'suv', vin_code: 'XYZ' },
        requiredColumnsToSkip: ['x'],
      },
    })).toEqual({
      summary: 'Create a new record in Cars',
      fields: [
        { label: 'Brand', to: 'Tesla' },
        { label: 'Model year', to: '2024' },
        { label: 'Sold', to: 'No' },
        { label: 'Body type', to: 'SUV' },
        { label: 'VIN', to: '••••••' },
      ],
    });
  });

  it('pairs every updated value with the value it replaces', async () => {
    expect(await formatApprovalRequest(adminforth, {
      toolName: 'update_record',
      args: { resourceId: 'cars_sl', recordId: '10', record: { brand: 'Ford', body_type: 'sedan' } },
    })).toEqual({
      summary: 'Update record with id:10 in Cars',
      fields: [
        { label: 'Brand', from: 'Toyota', to: 'Ford' },
        { label: 'Body type', from: 'SUV', to: 'Sedan' },
      ],
    });
  });

  it('never reveals the stored value of a masked column', async () => {
    const { fields } = await formatApprovalRequest(adminforth, {
      toolName: 'update_record',
      args: { resourceId: 'cars_sl', recordId: '10', record: { vin_code: 'NEW-VIN' } },
    });

    expect(fields).toEqual([{ label: 'VIN', from: '••••••', to: '••••••' }]);
  });

  it('reports blank values as empty instead of dropping them', async () => {
    const { fields } = await formatApprovalRequest(adminforth, {
      toolName: 'update_record',
      args: { resourceId: 'cars_sl', recordId: '10', record: { brand: null, model_year: 2020 } },
    });

    expect(fields).toEqual([
      { label: 'Brand', from: 'Toyota', to: 'empty' },
      { label: 'Model year', from: 'empty', to: '2020' },
    ]);
  });

  it('shows only the new values when the record does not exist', async () => {
    const { fields } = await formatApprovalRequest(adminforth, {
      toolName: 'update_record',
      args: { resourceId: 'cars_sl', recordId: '404', record: { brand: 'Ford' } },
    });

    expect(fields).toEqual([{ label: 'Brand', to: 'Ford' }]);
  });

  it('still describes the update when the stored record cannot be read', async () => {
    const { fields } = await formatApprovalRequest(adminforth, {
      toolName: 'update_record',
      args: { resourceId: 'cars_sl', recordId: 'unreachable', record: { brand: 'Ford' } },
    });

    expect(fields).toEqual([{ label: 'Brand', to: 'Ford' }]);
  });

  it('warns that a delete cannot be undone', async () => {
    expect(await formatApprovalRequest(adminforth, {
      toolName: 'delete_record',
      args: { resourceId: 'cars_sl', primaryKey: '10' },
    })).toEqual({ summary: 'Delete record with id:10 from Cars — this cannot be undone', fields: [] });
  });

  it('uses the action name rather than its id', async () => {
    expect(await formatApprovalRequest(adminforth, {
      toolName: 'start_custom_action',
      args: { resourceId: 'cars_sl', actionId: 'send_invoice', recordId: '10' },
    })).toEqual({ summary: 'Run "Send invoice" on record 10 in Cars', fields: [] });
  });

  it('counts the records a bulk action would touch', async () => {
    expect(await formatApprovalRequest(adminforth, {
      toolName: 'start_custom_bulk_action',
      args: { resourceId: 'cars_sl', actionId: 'archive', recordIds: ['1', '2', '3'] },
    })).toEqual({ summary: 'Run "Archive" on 3 record(s) in Cars', fields: [] });
  });

  it('falls back to the resource id when the resource is unknown', async () => {
    expect(await formatApprovalRequest(adminforth, {
      toolName: 'delete_record',
      args: { resourceId: 'ghosts', primaryKey: '1' },
    })).toEqual({ summary: 'Delete record with id:1 from ghosts — this cannot be undone', fields: [] });
  });

  it('lists the arguments as fields for an unrecognized tool', async () => {
    expect(await formatApprovalRequest(adminforth, {
      toolName: 'wipe_everything',
      args: { target: 'all', dry_run: true },
    })).toEqual({
      summary: 'Wipe everything',
      fields: [
        { label: 'Target', to: 'all' },
        { label: 'Dry run', to: 'Yes' },
      ],
    });
  });
});
