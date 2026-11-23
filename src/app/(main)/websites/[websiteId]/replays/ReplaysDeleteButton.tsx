import { ConfirmationForm } from '@/components/common/ConfirmationForm';
import { useMessages, useUpdateQuery } from '@/components/hooks';
import { Trash } from '@/components/icons';
import { DialogButton } from '@/components/input/DialogButton';

export function ReplaysDeleteButton({
  websiteId,
  replayIds,
  onDelete,
}: {
  websiteId: string;
  replayIds: string[];
  onDelete?: () => void;
}) {
  const { t, labels, messages, getErrorMessage } = useMessages();
  const { mutateAsync, isPending, error, touch } = useUpdateQuery(
    `/websites/${websiteId}/replays/delete`,
  );
  const count = replayIds.length;

  const handleConfirm = async (close: () => void) => {
    await mutateAsync(
      { replayIds },
      {
        onSuccess: () => {
          touch('replays');
          onDelete?.();
          close();
        },
      },
    );
  };

  return (
    <DialogButton
      aria-label={t(labels.delete)}
      data-test="button-delete-replays"
      icon={<Trash />}
      label={`${t(labels.delete)} (${count})`}
      title={t(labels.confirm)}
      variant="quiet"
      width="400px"
      isDisabled={count === 0}
    >
      {({ close }) => (
        <ConfirmationForm
          message={t(messages.confirmDelete, { target: `${count} ${t(labels.replays)}` })}
          isLoading={isPending}
          error={getErrorMessage(error)}
          onConfirm={handleConfirm.bind(null, close)}
          onClose={close}
          buttonLabel={t(labels.delete)}
          buttonVariant="danger"
        />
      )}
    </DialogButton>
  );
}
