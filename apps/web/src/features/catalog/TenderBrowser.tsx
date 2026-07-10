import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Col, Empty, Input, Pagination, Row, Segmented, Select, Space, Spin } from 'antd';
import { useMemo, useState } from 'react';
import type { TenderType } from '@zakupki/shared';
import { TenderCard } from '../../components/TenderCard';
import { fetchCategories, fetchTenders } from './api';

export function TenderBrowser({ mine = false }: { mine?: boolean }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TenderType | 'all'>('all');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [sort, setSort] = useState<'deadline_asc' | 'deadline_desc' | 'created_desc'>('deadline_asc');
  const [page, setPage] = useState(1);

  const catKind = type === 'all' ? undefined : type;
  const { data: categories } = useQuery({
    queryKey: ['categories', catKind],
    queryFn: () => fetchCategories(catKind),
  });

  const query = useMemo(
    () => ({
      page,
      limit: 12,
      search: search || undefined,
      type: type === 'all' ? undefined : type,
      categoryId,
      sort,
      mine: mine || undefined,
    }),
    [page, search, type, categoryId, sort, mine],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['tenders', query],
    queryFn: () => fetchTenders(query),
    placeholderData: (prev) => prev,
  });

  const categoryOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [];
    const walk = (nodes: typeof categories, depth = 0) => {
      for (const n of nodes ?? []) {
        opts.push({ label: `${'  '.repeat(depth)}${n.name}`, value: n.id });
        walk(n.children, depth + 1);
      }
    };
    walk(categories);
    return opts;
  }, [categories]);

  const resetPage =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  return (
    <>
      <Space wrap style={{ marginBottom: 24, width: '100%' }} size={12}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Поиск по названию"
          style={{ width: 300 }}
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
        />
        <Segmented
          value={type}
          onChange={(v) => resetPage(setType)(v as TenderType | 'all')}
          options={[
            { label: 'Все', value: 'all' },
            { label: 'СМР', value: 'smr' },
            { label: 'Материалы', value: 'materials' },
          ]}
        />
        <Select
          allowClear
          placeholder="Категория"
          style={{ width: 240 }}
          options={categoryOptions}
          value={categoryId}
          onChange={(v) => resetPage(setCategoryId)(v)}
          showSearch
          optionFilterProp="label"
        />
        <Select
          style={{ width: 190 }}
          value={sort}
          onChange={(v) => resetPage(setSort)(v)}
          options={[
            { label: 'Сначала срочные', value: 'deadline_asc' },
            { label: 'Дедлайн позже', value: 'deadline_desc' },
            { label: 'Сначала новые', value: 'created_desc' },
          ]}
        />
      </Space>

      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
          <Spin size="large" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Empty description="Тендеры не найдены" style={{ padding: 64 }} />
      ) : (
        <Spin spinning={isFetching}>
          <Row gutter={[20, 20]}>
            {data.items.map((t) => (
              <Col xs={24} sm={12} lg={8} key={t.id}>
                <TenderCard tender={t} />
              </Col>
            ))}
          </Row>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
            <Pagination
              current={data.page}
              pageSize={data.limit}
              total={data.total}
              onChange={setPage}
              showSizeChanger={false}
            />
          </div>
        </Spin>
      )}
    </>
  );
}
