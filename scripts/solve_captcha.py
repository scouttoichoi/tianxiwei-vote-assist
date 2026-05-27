import ddddocr
import sys
import os

# Tắt cảnh báo để Node.js không đọc nhầm log rác
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 

def main():
    try:
        # 1. Khởi tạo mô hình AI duy nhất 1 lần
        ocr = ddddocr.DdddOcr(show_ad=False)
        
        # 2. KHÓA TẬP KÝ TỰ (Whitelist)
        # Chỉ cho phép AI trả về số từ 0-9 và chữ cái A-Z
        ocr.set_ranges("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        
        # Báo hiệu cho Node.js biết AI đã sẵn sàng
        print("READY", flush=True)
        
        # 3. Đọc và giải mã ảnh liên tục từ Standard Input
        for line in sys.stdin:
            image_path = line.strip()
            if not image_path:
                continue
            if image_path == "EXIT":
                break
                
            try:
                if not os.path.exists(image_path):
                    print("ERROR: File không tồn tại", flush=True)
                    continue
                    
                with open(image_path, 'rb') as f:
                    image_bytes = f.read()
                    
                result = ocr.classification(image_bytes)
                print(result, flush=True)
                
            except Exception as e:
                print(f"ERROR: {e}", flush=True)
                
    except Exception as e:
        print(f"INIT_ERROR: {e}", flush=True)

if __name__ == "__main__":
    main()