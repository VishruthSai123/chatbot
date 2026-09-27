"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { UIArtifact } from "@/components/chat/artifact";

export const initialArtifactData: UIArtifact = {
  boundingBox: {
    height: 0,
    left: 0,
    top: 0,
    width: 0,
  },
  content: "",
  documentId: "init",
  isVisible: false,
  kind: "text",
  status: "idle",
  title: "",
};

type Selector<T> = (state: UIArtifact) => T;

export function useArtifactSelector<Selected>(selector: Selector<Selected>) {
  const { data: localArtifact } = useSWR<UIArtifact>("artifact", null, {
    fallbackData: initialArtifactData,
  });

  const selectedValue = useMemo(() => {
    if (!localArtifact) {
      return selector(initialArtifactData);
    }
    return selector(localArtifact);
  }, [localArtifact, selector]);

  return selectedValue;
}

export function useArtifactMetadataSelector<Selected>(
  selector: (metadata: any) => Selected
) {
  const documentId = useArtifactSelector((state) => state.documentId);
  const { data: localArtifactMetadata } = useSWR<any>(
    documentId ? `artifact-metadata-${documentId}` : null,
    null,
    {
      fallbackData: null,
    }
  );

  return useMemo(
    () => selector(localArtifactMetadata),
    [localArtifactMetadata, selector]
  );
}

export function useArtifactActions() {
  const { mutate } = useSWRConfig();
  const documentId = useArtifactSelector((state) => state.documentId);

  const setArtifact = useCallback(
    (updaterFn: UIArtifact | ((currentArtifact: UIArtifact) => UIArtifact)) => {
      mutate("artifact", (currentArtifact: UIArtifact | undefined) => {
        const artifactToUpdate = currentArtifact || initialArtifactData;
        if (typeof updaterFn === "function") {
          return updaterFn(artifactToUpdate);
        }
        return updaterFn;
      });
    },
    [mutate]
  );

  const setMetadata = useCallback(
    (updaterFn: any) => {
      if (!documentId) {
        return;
      }
      mutate(`artifact-metadata-${documentId}`, (current: any) => {
        const metadataToUpdate = current ?? {};
        if (typeof updaterFn === "function") {
          return updaterFn(metadataToUpdate);
        }
        return updaterFn;
      });
    },
    [mutate, documentId]
  );

  return useMemo(
    () => ({ setArtifact, setMetadata }),
    [setArtifact, setMetadata]
  );
}

export function useArtifact() {
  const { data: localArtifact, mutate: setLocalArtifact } = useSWR<UIArtifact>(
    "artifact",
    null,
    {
      fallbackData: initialArtifactData,
    }
  );

  const artifact = useMemo(() => {
    if (!localArtifact) {
      return initialArtifactData;
    }
    return localArtifact;
  }, [localArtifact]);

  const setArtifact = useCallback(
    (updaterFn: UIArtifact | ((currentArtifact: UIArtifact) => UIArtifact)) => {
      setLocalArtifact((currentArtifact) => {
        const artifactToUpdate = currentArtifact || initialArtifactData;

        if (typeof updaterFn === "function") {
          return updaterFn(artifactToUpdate);
        }

        return updaterFn;
      });
    },
    [setLocalArtifact]
  );

  const { data: localArtifactMetadata, mutate: setLocalArtifactMetadata } =
    useSWR<any>(
      () =>
        artifact.documentId ? `artifact-metadata-${artifact.documentId}` : null,
      null,
      {
        fallbackData: null,
      }
    );

  const setMetadata = useCallback(
    (updaterFn: any) => {
      setLocalArtifactMetadata((current: any) => {
        const metadataToUpdate = current ?? {};

        if (typeof updaterFn === "function") {
          return updaterFn(metadataToUpdate);
        }

        return updaterFn;
      });
    },
    [setLocalArtifactMetadata]
  );

  return useMemo(
    () => ({
      artifact,
      metadata: localArtifactMetadata,
      setArtifact,
      setMetadata,
    }),
    [artifact, setArtifact, localArtifactMetadata, setMetadata]
  );
}
