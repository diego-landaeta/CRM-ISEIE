import { useState, useEffect, useCallback } from 'react';
import client from '@/shared/api/client';
import type { Product } from '../api/products.api';

export interface UseProductsResult {
  products: Product[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (payload: Partial<Product>) => Promise<Product | null>;
  update: (id: number, payload: Partial<Product>) => Promise<Product | null>;
  deactivate: (id: number) => Promise<Product | null>;
}

export function useProducts(projectId: number | null | undefined): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.get(`/products?projectId=${projectId}`);
      if (res.success) {
        setProducts((res.data as Product[]) || []);
      }
    } catch (err: any) {
      setError(err.message);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // CRUD: el middleware projectAccess lee projectId desde body o query
  const create = useCallback(async (payload: Partial<Product>): Promise<Product | null> => {
    if (!projectId) return null;
    const res = await client.post('/products', { ...payload, projectId });
    if (res.success) {
      await fetchProducts();
      return (res.data as Product) || null;
    }
    return null;
  }, [projectId, fetchProducts]);

  const update = useCallback(async (id: number, payload: Partial<Product>): Promise<Product | null> => {
    const res = await client.patch(`/products/${id}?projectId=${projectId}`, payload);
    if (res.success) {
      await fetchProducts();
      return (res.data as Product) || null;
    }
    return null;
  }, [projectId, fetchProducts]);

  const deactivate = useCallback(async (id: number): Promise<Product | null> => {
    const res = await client.delete(`/products/${id}?projectId=${projectId}`);
    if (res.success) {
      await fetchProducts();
      return (res.data as Product) || null;
    }
    return null;
  }, [projectId, fetchProducts]);

  return { products, loading, error, refetch: fetchProducts, create, update, deactivate };
}

export default useProducts;
