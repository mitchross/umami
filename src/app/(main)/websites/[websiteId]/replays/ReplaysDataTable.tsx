import { Row } from '@umami/react-zen';
import { useEffect, useState } from 'react';
import { DataGrid } from '@/components/common/DataGrid';
import { useNavigation, useReplaysQuery } from '@/components/hooks';
import { ReplayFilterButton } from './ReplayFilterButton';
import { ReplaysDeleteButton } from './ReplaysDeleteButton';
import { ReplaysTable } from './ReplaysTable';

const DEFAULT_MIN_DURATION = 5;

export function ReplaysDataTable({ websiteId }: { websiteId: string }) {
  const { query } = useNavigation();
  const minDuration =
    typeof query.minDuration === 'string' && /^\d+$/.test(query.minDuration)
      ? query.minDuration
      : String(DEFAULT_MIN_DURATION);
  const queryResult = useReplaysQuery(websiteId, { minDuration });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const canDelete = !!(queryResult.data as { canDelete?: boolean } | undefined)?.canDelete;

  // A new page, search or refetch shows different rows, so start the selection over.
  useEffect(() => {
    setSelected(new Set());
  }, [queryResult.data]);

  return (
    <DataGrid
      query={queryResult}
      allowPaging
      allowSearch
      renderActions={() => (
        <Row gap alignItems="center">
          {selected.size > 0 && (
            <ReplaysDeleteButton
              websiteId={websiteId}
              replayIds={[...selected]}
              onDelete={() => setSelected(new Set())}
            />
          )}
          <ReplayFilterButton />
        </Row>
      )}
    >
      {({ data }) => {
        return (
          <ReplaysTable
            websiteId={websiteId}
            data={data}
            selectionMode={canDelete ? 'multiple' : 'none'}
            selectedKeys={selected}
            onSelectionChange={setSelected}
          />
        );
      }}
    </DataGrid>
  );
}
