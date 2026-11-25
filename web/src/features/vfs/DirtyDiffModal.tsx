import { Modal } from "@/components/Modal";
import { LineDiffView } from "./LineDiffView";

interface DirtyDiffModalProps {
  open: boolean;
  /** Đường dẫn file đang sửa (file mới chưa ghi → hiển thị đường dẫn đang gõ). */
  path: string;
  /** Nội dung gốc đã lưu trong kho — file mới thì rỗng (toàn bộ là dòng thêm). */
  before: string;
  /** Nội dung đang sửa trong editor. */
  after: string;
  onClose: () => void;
}

/**
 * Xem diff chưa lưu: so nội dung đã lưu (kho) với nội dung đang sửa,
 * dùng cùng bộ diff theo dòng của trang Quản lý.
 */
export function DirtyDiffModal({ open, path, before, after, onClose }: DirtyDiffModalProps) {
  return (
    <Modal open={open} onClose={onClose} width={760} title={`Thay đổi chưa lưu — ${path}`}>
      <LineDiffView before={before} after={after} maxHeight={420} />
      <div className="vfs-dim vfs-small" style={{ marginTop: 10 }}>
        Diff so với bản đã lưu trong kho. Bấm <b>Lưu</b> (hoặc <span className="kbd">Ctrl+S</span>) để ghi vào kho.
      </div>
    </Modal>
  );
}
