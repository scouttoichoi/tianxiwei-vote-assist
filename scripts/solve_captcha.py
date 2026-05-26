import ddddocr
import sys
import os

# Tắt cảnh báo để Node.js không đọc nhầm log rác
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 

def main():
    if len(sys.argv) < 2:
        print("ERROR: Thiếu đường dẫn ảnh")
        return
        
    image_path = sys.argv[1]
    
    try:
        # 1. Khởi tạo mô hình AI
        ocr = ddddocr.DdddOcr(show_ad=False)
        
        # 2. KHÓA TẬP KÝ TỰ (Whitelist)
        # Chỉ cho phép AI trả về số từ 0-9 và chữ cái A-Z
        ocr.set_ranges("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        
        # 3. Đọc và giải mã ảnh
        with open(image_path, 'rb') as f:
            image_bytes = f.read()
            
        result = ocr.classification(image_bytes)
        print(result)
        
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    main()