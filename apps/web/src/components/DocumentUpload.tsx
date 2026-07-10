import { DeleteOutlined, FileTextOutlined, UploadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, List, Typography, Upload } from 'antd';
import type { FileMeta, FileOwner } from '@zakupki/shared';
import { api, uploadFile } from '../api/client';

const { Text } = Typography;

export function DocumentUpload({
  ownerType,
  ownerId,
  isPublic,
  canEdit = true,
  disabledHint,
}: {
  ownerType: FileOwner;
  ownerId?: string;
  isPublic?: boolean;
  canEdit?: boolean;
  disabledHint?: string;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const key = ['files', ownerType, ownerId];

  const { data: docs } = useQuery({
    queryKey: key,
    queryFn: () => api<FileMeta[]>('/files', { query: { ownerType, ownerId: ownerId! } }),
    enabled: Boolean(ownerId),
  });

  if (!ownerId) {
    return <Text type="secondary">{disabledHint ?? 'Сначала сохраните карточку, затем прикрепите документы.'}</Text>;
  }

  return (
    <div>
      <List
        size="small"
        locale={{ emptyText: 'Документы не прикреплены' }}
        dataSource={docs ?? []}
        renderItem={(f) => (
          <List.Item
            actions={
              canEdit
                ? [
                    <Button
                      key="del"
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={async () => {
                        await api(`/files/${f.id}`, { method: 'DELETE' }).catch(() => {});
                        qc.invalidateQueries({ queryKey: key });
                      }}
                    />,
                  ]
                : []
            }
          >
            <a href={`/api/v1/files/${f.id}`} target="_blank" rel="noreferrer">
              <FileTextOutlined /> {f.originalName}
            </a>
          </List.Item>
        )}
      />
      {canEdit && (
        <Upload
          showUploadList={false}
          multiple
          customRequest={async ({ file, onSuccess, onError }) => {
            try {
              await uploadFile('/files', file as File, { ownerType, ownerId, isPublic });
              qc.invalidateQueries({ queryKey: key });
              message.success('Файл загружен');
              onSuccess?.({});
            } catch (err) {
              message.error('Ошибка загрузки файла');
              onError?.(err as Error);
            }
          }}
        >
          <Button icon={<UploadOutlined />} style={{ marginTop: 8 }}>
            Загрузить документ
          </Button>
        </Upload>
      )}
    </div>
  );
}
